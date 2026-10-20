/** Git-backed public memory, skills and harness: admission only, never authority. */
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';

const TYPES = Object.freeze({
  memory: /^hubs\/memory\/[a-z0-9-]+\.json$/,
  skill: /^hubs\/skills\/[a-z0-9-]+\/SKILL\.md$/,
  harness: /^hubs\/harness\/[a-z0-9-]+\.json$/,
});
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9-]{2,63}$/;
const ALLOWED_COMMANDS = new Set(['/help', '/system status', '/repo inspect', '/learning status']);
const forbidden = /(?:sk-[a-zA-Z0-9]{16,}|gh[opusr]_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{15,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const reject = message => { throw new Error('Git hub rejected: '+message); };

export function contentDigest(text) {
  if(typeof text!=='string')reject('content must be text');
  return createHash('sha256').update(text,'utf8').digest('hex');
}

/** Reproducible hashes preserve all nested keys and array order. */
export function canonicalJson(value) {
  if(value===null)return 'null';
  if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}';
  }
  reject('unsupported or non-finite snapshot value');
}
export const snapshotSha = snapshot => contentDigest(canonicalJson(snapshot));

export function evaluateHubEntry({entry,source,tests=[]}) {
  if(!entry||!TYPES[entry.kind]||!ID.test(entry.id||'')||
     !TYPES[entry.kind].test(entry.path||'')||!SHA.test(entry.sha256||'')||
     !Number.isSafeInteger(entry.revision)||entry.revision<1||
     !Array.isArray(entry.tests)||!entry.tests.length||
     entry.tests.some(t=>typeof t!=='string'||!/^test\/[a-z0-9-]+\.test\.mjs$/.test(t)) ||
     !entry.tests.every(t=>tests.includes(t)))reject('invalid index, revision or missing verified test');
  if(contentDigest(source)!==entry.sha256)reject('content fingerprint mismatch for '+entry.path);
  if(forbidden.test(source))reject('credential-like material in public hub file');
  if(entry.kind==='skill'){
    for(const heading of [/^# Skill: .+$/m,/^## Inputs\s*$/m,/^## Fail-Closed Rules\s*$/m,/^## Test Evidence\s*$/m]){
      if(!heading.test(source))reject('skill playbook missing required section: '+entry.path);
    }
    if(!source.includes('test/git-hubs.test.mjs'))reject('skill test evidence missing');
  }else{
    let json;
    try{json=JSON.parse(source);}catch{reject('invalid JSON: '+entry.path)}
    if(json.kind!==entry.kind||json.id!==entry.id||json.revision!==entry.revision)
      reject('identity/version mismatch: '+entry.path);
    if(entry.kind==='memory'){
      if(json.visibility!=='public'||!Array.isArray(json.facts)||!json.facts.length ||
         json.facts.some(f=>typeof f!=='string'||!f.trim()||f.length>500)||
         !Array.isArray(json.evidence)||!json.evidence.length||
         json.evidence.some(url=>typeof url!=='string'||!url.startsWith('https://github.com/michaeljwilliams0123/Ultron.MW/')))
        reject('memory facts require public classification and GitHub evidence');
    }else if(entry.kind==='harness'){
      if(json.authority!=='read-only'||!Array.isArray(json.commands)||!json.commands.length||
         json.commands.some(c=>!ALLOWED_COMMANDS.has(c))||
         !Array.isArray(json.skills)||!json.skills.length)
        reject('harness cannot grant operations beyond the existing read-only catalogue');
    }
  }
  return Object.freeze({kind:entry.kind,id:entry.id,path:entry.path,
    revision:entry.revision,sha256:entry.sha256});
}

/** Used by existing required Verify. Refuse symlinked artifacts. */
export async function verifyGitHubs(root) {
  const raw=await readFile(resolve(root,'hubs/catalog.json'),'utf8');
  let catalog;try{catalog=JSON.parse(raw);}catch{reject('catalog is not JSON')}
  if(catalog?.schemaVersion!==1||!Array.isArray(catalog.entries)||
     catalog.entries.length<3||catalog.entries.length>100)reject('invalid catalog');
  const paths=new Set(),identities=new Set();
  const testFiles=new Set();
  for(const entry of catalog.entries){
    for(const p of entry.tests||[]){
      if(typeof p!=='string'||!/^test\/[a-z0-9-]+\.test\.mjs$/.test(p))
        reject('test path not allowed');
      testFiles.add(p);
    }
  }
  for(const testFile of testFiles){
    if(!(await lstat(resolve(root,testFile))).isFile())reject('missing regular test file: '+testFile);
  }
  const accepted=[];
  for(const entry of catalog.entries){
    if(paths.has(entry.path)||identities.has(entry.kind+':'+entry.id))reject('duplicate entry');
    paths.add(entry.path);identities.add(entry.kind+':'+entry.id);
    const abs=resolve(root,entry.path);
    const metadata=await lstat(abs);
    if(!metadata.isFile()||metadata.size>16000)reject('hub artifact size exceeded');
    accepted.push(evaluateHubEntry({entry,source:await readFile(abs,'utf8'),tests:[...testFiles]}));
  }
  for(const type of Object.keys(TYPES))if(!accepted.some(x=>x.kind===type))reject('missing required hub: '+type);
  for(const item of accepted.filter(x=>x.kind==='harness')){
    const harness=JSON.parse(await readFile(resolve(root,item.path),'utf8'));
    for(const skillId of harness.skills){
      if(!accepted.some(x=>x.kind==='skill'&&x.id===skillId))reject('unknown skill: '+skillId);
    }
  }
  return Object.freeze({schemaVersion:1,accepted:accepted.length,
    byType:Object.freeze(Object.fromEntries(Object.keys(TYPES).map(kind=>
      [kind,accepted.filter(x=>x.kind===kind).length]))),
    indexSha256:contentDigest(raw)});
}
