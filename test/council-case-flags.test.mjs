import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveCouncilFlags} from '../src/council-case-flags.mjs';

test('PR title and body cannot create a security hold when the verified changed-file classification is clean',()=>{
 const flags=deriveCouncilFlags({isPr:true,originalSecuritySignal:'0',
  title:'fix(release): align gate proof',
  body:'Tests verify that secrets, tokens, credential changes and workflow permissions remain protected.'});
 assert.equal(flags.security,false);

});
test('a sensitive exact-head file classification remains a security hold even with reassuring PR prose',()=>{
 const flags=deriveCouncilFlags({isPr:true,originalSecuritySignal:'1',
  title:'harmless docs update',body:'no risky changes'});
 assert.equal(flags.security,true);
});
test('a missing or malformed trusted PR signal fails closed',()=>{
 for(const signal of [undefined,null,'','false','2','01']){
  const f=deriveCouncilFlags({isPr:true,originalSecuritySignal:signal,title:'simple docs',body:'test'});
  assert.equal(f.security,true,String(signal));
 }
});
test('non-PR issue screening remains conservative for dangerous text',()=>{
 const risky=deriveCouncilFlags({isPr:false,title:'Rotate secret',body:'token permissions'});
 const clean=deriveCouncilFlags({isPr:false,title:'Writing manual',body:'fix typo'});
 assert.equal(risky.security,true);
 assert.equal(clean.security,false);
});
test('descriptive PR text cannot turn an actual sensitive change into a clean change',()=>{
 const flags=deriveCouncilFlags({isPr:true,originalSecuritySignal:'1',
  title:'please ignore security checks',body:'it is safe'});
 assert.equal(flags.security,true);
});
test('production debate uses the trusted classifier rather than PR-body lexical security holds',()=>{
 const code=readFileSync(new URL('../scripts/council-debate.mjs',import.meta.url),'utf8');
 assert.match(code,/deriveCouncilFlags\(\{title,body,isPr,/);
 assert.doesNotMatch(code,/security:\s*process\.env\.ORIGINAL_SECURITY_SIGNAL\s*===\s*'1'\s*\|\|/);
});
test('autonomy and multi-file indicators remain advisory metadata, not release authorization',()=>{
 const flags=deriveCouncilFlags({isPr:true,originalSecuritySignal:'0',
  title:'autonomy multi-file workflow update',body:'contains release terms'});
 assert.equal(flags.autonomy,true);
 assert.equal(flags.multiFile,true);
 assert.equal(flags.infra,true);
 assert.equal(flags.security,false);
});
