#!/usr/bin/env node
// Read-only source-tree credential audit. Never logs matches, values or context.
// This cannot inspect Actions/environment secrets, historic Git objects or logs.
import {spawnSync} from 'node:child_process';
import {readFileSync,lstatSync} from 'node:fs';
import {createPrivateKey} from 'node:crypto';
import {resolve,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const MAX_TEXT_BYTES=8*1024*1024;
const candidates=/\.(?:js|mjs|cjs|ts|tsx|jsx|json|jsonc|yaml|yml|env|md|mdx|txt|sh|ps1|py|sql|toml|xml|html|css|ini|properties|cfg|conf|graphql|tf|tfvars|rb|go|rs|java|gradle)$/i;
const keyFile=/(?:^|\/)[^/]+\.(?:pem|p12|pfx|key|jks|keystore)$/i;
const dotEnv=/(?:^|\/)\.env(?:\.[^/]+)?$/i;
const exceptionEnv=/\.env\.(?:example|sample|template|dist)$/i;
const pemPattern=/-----BEGIN (?:(?:RSA|EC|OPENSSH|DSA|ENCRYPTED) )?PRIVATE KEY-----[\s\S]*?-----END (?:(?:RSA|EC|OPENSSH|DSA|ENCRYPTED) )?PRIVATE KEY-----/g;
const tokenPatterns=[
 ['GITHUB_TOKEN',/\b(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{35,}\b/g],
 ['GITHUB_TOKEN',/\bgithub_pat_[a-zA-Z0-9_]{35,}\b/g],
 ['OPENAI_TOKEN',/\bsk-proj-[a-zA-Z0-9_-]{20,}\b/g],
 ['AWS_ACCESS_KEY',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g]
];

function fileInventory(root){
 const git=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{
  cwd:root,encoding:'buffer',windowsHide:true,maxBuffer:16*1024*1024
 });
 if(git.error||git.status!==0)throw Error('git-file-inventory-unavailable');
 return [...new Set(git.stdout.toString('utf8').split('\0').filter(Boolean))].sort();
}
export function scanTrackedRoot(repoRoot){
 const root=resolve(repoRoot),findings=[];let scannedFiles=0,skippedBinary=0;
 const inventory=fileInventory(root);
 const flag=(path,code)=>findings.push({path,code}); // NEVER include matched values
 for(const name of inventory){
  const normalized=name.replaceAll('\\','/');
  if(normalized.startsWith('../')||normalized.startsWith('/')||normalized.includes('/../')){
   flag(normalized,'UNSAFE_PATH');continue;
  }
  const full=join(root,name);
  if(relative(root,full).startsWith('..'+sep)){flag(normalized,'UNSAFE_PATH');continue}
  let info;
  try{info=lstatSync(full)}catch{flag(normalized,'READ_FAILURE');continue}
  if(info.isSymbolicLink()){flag(normalized,'SYMLINK');continue}
  if(!info.isFile()){flag(normalized,'UNEXPECTED_FILE_TYPE');continue}
  if(keyFile.test(normalized)||(dotEnv.test(normalized)&&!exceptionEnv.test(normalized))){
   flag(normalized,'SENSITIVE_PATH');continue;
  }
  if(!candidates.test(normalized)&&!normalized.endsWith('/Dockerfile')
    &&!normalized.endsWith('/Makefile')&&normalized!=='Dockerfile'
    &&normalized!=='Makefile')continue;
  if(info.size>MAX_TEXT_BYTES){flag(normalized,'OVERSIZED_TEXT');continue}
  let raw;
  try{raw=readFileSync(full)}catch{flag(normalized,'READ_FAILURE');continue}
  if(raw.includes(0)){flag(normalized,'BINARY_TEXT');skippedBinary++;continue}
  scannedFiles++;
  const body=raw.toString('utf8');
  const matches=[...body.matchAll(pemPattern)];
  for(const hit of matches){
   // Test source legitimately describes malformed PEM boundary fixtures.
   // A parseable private key must ALWAYS fail, even in test modules.
   let real=false;
   try{createPrivateKey(hit[0].replaceAll('\\n','\n'));real=true}catch{}
   if(real||!normalized.startsWith('test/'))flag(normalized,'PRIVATE_KEY');
  }
  for(const [code,re] of tokenPatterns){
   re.lastIndex=0;
   if(re.test(body))flag(normalized,code);
  }
 }
 return {scannedFiles,skippedBinary,findings};
}

const own=fileURLToPath(import.meta.url);
if(process.argv[1]&&resolve(process.argv[1])===resolve(own)){
 try{
  const result=scanTrackedRoot(resolve(own,'..','..'));
  if(result.findings.length){
   console.error('Secret isolation SOURCE audit: FAILED ('+result.findings.length+' findings).');
   for(const f of result.findings)console.error(f.code+' in '+f.path);
   process.exitCode=1;
  }else{
   console.log('Secret isolation SOURCE audit: PASSED; '+result.scannedFiles+
    ' text files scanned; '+result.skippedBinary+' binary files skipped.');
   console.log('Not proof of Actions/Vault custody, history or runner-log isolation.');
  }
 }catch(err){
  console.error('Secret isolation SOURCE audit: UNAVAILABLE ('+err.message+').');
  process.exitCode=2;
 }
}
