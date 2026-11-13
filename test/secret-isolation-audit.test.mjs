import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {scanTrackedRoot} from '../scripts/audit-secret-isolation.mjs';

function sandbox(files,verify){
 const root=mkdtempSync(join(tmpdir(),'ultron-secret-scan-'));
 try{
  const run=(...args)=>{
   const result=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});
   if(result.status!==0)throw Error(result.stderr);
  };
  run('init','-q');
  for(const [name,data] of Object.entries(files)){
   mkdirSync(dirname(join(root,name)),{recursive:true});
   writeFileSync(join(root,name),data);
  }
  run('add','.');
  return verify(root,run);
 }finally{rmSync(root,{recursive:true,force:true})}
}
test('source audit ignores references to secret names and fake PEM descriptions',()=>{
 sandbox({
  'src/module.mjs':"const key = process.env.PRIVATE_KEY;\nconst webhook_secret=process.env.WEBHOOK_SECRET;",
  'test/sample.test.mjs':"const example = '-----BEGIN PRIVATE KEY-----\\nNOT_A_KEY\\n-----END PRIVATE KEY-----';",
  'docs/security.md':"Use the env var webhook_secret but do not print it."
 },root=>{
  const result=scanTrackedRoot(root);
  assert.equal(result.findings.length,0,JSON.stringify(result.findings));
  assert.ok(result.scannedFiles>=3);
 });
});
test('fails on valid PEM private key and does not reproduce its text',()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const pem=privateKey.export({format:'pem',type:'pkcs8'}).toString();
 sandbox({'src/credentials.mjs':'export const key = '+JSON.stringify(pem)+';'},root=>{
  const result=scanTrackedRoot(root);
  assert.ok(result.findings.some(x=>x.code==='PRIVATE_KEY'));
  assert.ok(!JSON.stringify(result).includes(pem.slice(30,110)));
 });
});
test('detects embedded GitHub token value and redacts it from findings',()=>{
 const token='ghp_'+'A'.repeat(36);
 sandbox({'cloud/hatchable/config.js':"export const accessToken = '"+token+"';"},root=>{
  const result=scanTrackedRoot(root);
  assert.ok(result.findings.some(x=>x.code==='GITHUB_TOKEN'));
  assert.ok(!JSON.stringify(result).includes(token));
 });
});
test('fails when a real dotenv file is tracked and does not expose content',()=>{
 const key='reallyLongCredentialValue1234567890';
 sandbox({'.env':'TOKEN='+key},root=>{
  const result=scanTrackedRoot(root);
  assert.ok(result.findings.some(x=>x.code==='SENSITIVE_PATH'));
  assert.ok(!JSON.stringify(result).includes(key));
 });
});
test('rejects linked files rather than following them outside the audit root',()=>{
 sandbox({'src/a.js':'safe'},(root,run)=>{
  const file=join(root,'src','external.js');
  try{symlinkSync(join(root,'src','a.js'),file)}catch{return}
  run('add','src/external.js');
  const result=scanTrackedRoot(root);
  assert.ok(result.findings.some(x=>x.code==='SYMLINK'));
 });
});
test('scans untracked source files locally before they are staged',()=>{
 sandbox({'src/safe.js':'const ok=true;'},root=>{
  writeFileSync(join(root,'src','new-token.js'),"const token='ghp_"+'b'.repeat(36)+"';");
  const result=scanTrackedRoot(root);
  assert.ok(result.findings.some(x=>x.code==='GITHUB_TOKEN'&&x.path==='src/new-token.js'));
 });
});

test('CI enforces source credential scan in the existing core lane without adding a ninth workflow',async()=>{
 const {readFileSync,existsSync}=await import('node:fs');
 const standalone=new URL('../.github/workflows/secret-isolation.yml',import.meta.url);
 assert.equal(existsSync(standalone),false,'standalone secret audit would violate the eight-workflow lane contract');
 const core=readFileSync(new URL('../.github/workflows/verify.yml',import.meta.url),'utf8');
 assert.match(core,/name: Audit source for accidental credentials[\s\S]*?run: node scripts\/audit-secret-isolation\.mjs/);
 const scanner=core.indexOf('run: node scripts/audit-secret-isolation.mjs');
 const install=core.indexOf('npm ci --ignore-scripts');
 assert.ok(scanner>=0 && install>scanner,'source scan must run before dependency installation');
 assert.match(core,/actions\/checkout@[a-f0-9]{40}/);
 assert.match(core,/persist-credentials: false/);
});

test('NUL-containing text source fails closed rather than bypassing credential scanning',()=>{
 sandbox({'docs/suspicious.md':Buffer.from('prefix\0ghp_'+('A'.repeat(36)))},root=>{
  const result=scanTrackedRoot(root);
  assert.ok(result.findings.some(x=>x.path==='docs/suspicious.md'&&x.code==='BINARY_TEXT'),
   'NUL-containing text files must not silently skip security findings');
  assert.ok(!JSON.stringify(result).includes('ghp_'+('A'.repeat(36))));
 });
});
