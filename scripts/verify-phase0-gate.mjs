#!/usr/bin/env node
// Fail-closed Phase 0 SOURCE/SCHEMA gate. Never prints secret values.
// A passing local gate is not an Admin App credential-custody attestation.
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';

const root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const required=[
 'docs/ADMIN-EXECUTOR.md','docs/CANONICAL-GITHUB-IDENTITY.md',
 'docs/GITHUB-CRYPTO-APPROVAL.md',
 'cloud/hatchable/migrations/0008_admin_grants.sql',
 'cloud/hatchable/migrations/0009_signed_event_inbox.sql',
 'cloud/hatchable/migrations/0023_owner_vault.sql',
 'cloud/hatchable/migrations/0033_owner_passkey_authority.sql',
 'cloud/hatchable/migrations/0034_owner_passkey_enrollment.sql',
 'cloud/hatchable/migrations/0037_github_approval_nonces.sql',
 'cloud/hatchable/migrations/0040_ultron_org_transfer.sql',
 'cloud/hatchable/migrations/0041_github_pr_comment_executions.sql',
 'cloud/hatchable/migrations/0046_admin_passkey_stepup.sql',
 'cloud/hatchable/lib/rsa-pkcs1-sign.js'
];
const pinned=new Map([
 ['docs/ADMIN-EXECUTOR.md','713b4b63a079576e9bd14350957d1e538d94d266'],
 ['docs/CANONICAL-GITHUB-IDENTITY.md','1c5bb1e9a886adeefd7668466f7ccefb0c73dd8b'],
 ['docs/GITHUB-CRYPTO-APPROVAL.md','13b671360b1bc6141f13233ad75a954c50c93c07'],
 ['cloud/hatchable/migrations/0008_admin_grants.sql','27e05e34e449cf99277cc7c9846d0603d13a6412'],
 ['cloud/hatchable/migrations/0009_signed_event_inbox.sql','0283fae2099728f53d1c438ca690dc9801f24783'],
 ['cloud/hatchable/migrations/0023_owner_vault.sql','aa4addcc6c59712e043b073e31e13d000c9c0ed8'],
 ['cloud/hatchable/migrations/0033_owner_passkey_authority.sql','892d0a419a7ae9ed772a2fdbc9e4a28a75cee3c6'],
 ['cloud/hatchable/migrations/0034_owner_passkey_enrollment.sql','b3ead4488974e7a6e4ccae79d7c237b3a0dc16cd'],
 ['cloud/hatchable/migrations/0037_github_approval_nonces.sql','096e43347cc943caaf7445cf22417b8d9b2b0a33'],
 ['cloud/hatchable/migrations/0041_github_pr_comment_executions.sql','317a2c9c54ec69250abb3afe9ed66d5e1c9f8860'],
 ['cloud/hatchable/lib/rsa-pkcs1-sign.js','1bc303acb8fe63df478914bb611d0f9f68cd47aa']
]);
const assert=(p,message)=>{if(!p)throw Error(message)};
const git=(args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const sha=(s)=>createHash('sha256').update(s).digest('hex');
const normalizedSql=(s)=>s.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim();
const pglite=await import('@electric-sql/pglite').catch(()=>null);
if(!pglite?.PGlite)throw Error('Phase 0 BLOCKED: real PostgreSQL test harness @electric-sql/pglite is unavailable');
assert(git(['rev-parse','--show-toplevel']).replaceAll('\\','/').toLowerCase()===root.replaceAll('\\','/').toLowerCase(),'Incorrect audit checkout');
const shaMap={};
for(const file of required){
 const content=await readFile(join(root,file),'utf8');
 assert(content.length>0,'Empty file '+file);
 shaMap[file]=sha(content);
 if(pinned.has(file)){
  const blob=git(['hash-object',file]);
  assert(blob===pinned.get(file),'Source parity mismatch: '+file);
 }
}
const original040=git(['show','HEAD:cloud/hatchable/migrations/0040_ultron_org_transfer.sql']);
const changed040=await readFile(join(root,'cloud/hatchable/migrations/0040_ultron_org_transfer.sql'),'utf8');
assert(normalizedSql(original040)===normalizedSql(changed040),'Historical 0040 SQL behavior altered');
assert(changed040.includes('New runtime mutations MUST target michaeljwilliams0123/Ultron.MW'),'0040 canonical identity documentation missing');
const stepup=await readFile(join(root,'cloud/hatchable/migrations/0046_admin_passkey_stepup.sql'),'utf8');
assert(!/allow_(?:admin_executor|vault_custody|signed_events)\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+TRUE/i.test(stepup),'Administrative permission defaults to TRUE');
assert(!/\bUPDATE\s+brain_owner_autonomy_profile\b/i.test(stepup),'Migration silently expands owner autonomy');
assert(!/ALTER\s+TABLE\s+brain_owner_passkey_challenges/i.test(stepup),'Legacy 0033 challenge modified');
assert(/admin-passkey-stepup-consumed-immutable/.test(stepup),'Single-use replay guard missing');
assert(!required.includes('cloud/hatchable/migrations/0041_admin_passkey_stepup.sql'),'0041 collision');

const changed=git(['status','--porcelain']).split('\n').filter(Boolean);
const suspects=[...new Set(changed.map(x=>x.slice(3)).filter(x=>x&&!x.includes('->')))];
const prohibited=/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|(?:ghp_|github_pat_)[A-Za-z0-9_]{25,}|sk-proj-[A-Za-z0-9_-]{20,}/;
for(const name of suspects){
 const full=join(root,name);
 try{const st=await stat(full);if(!st.isFile()||st.size>1024*1024)continue;
  const body=await readFile(full,'utf8');
  assert(!prohibited.test(body),'Possible plaintext credential in working tree file: '+name);
 }catch(err){if(err.code!=='ENOENT')throw err}
}
const envSecretNames=Object.keys(process.env).filter(k=>/PRIVATE_KEY|WEBHOOK_SECRET|VAULT_KEY|ADMIN_APP_SECRET/i.test(k));
console.log('Audited required contracts:',required.length,
 'repo status entries:',changed.length,
 'secret-like environment variable names present:',envSecretNames.length,
 '(values never displayed)');
console.log('Source hashes (SHA-256):',Object.fromEntries([
 '0040_ultron_org_transfer.sql','0046_admin_passkey_stepup.sql'
].map(s=>[s,shaMap['cloud/hatchable/migrations/'+s].slice(0,16)])));
const files=[
 'test/hatchable-admin-passkey-stepup-migration.test.mjs',
 'test/canonical-repository-transfer.test.mjs',
 'test/github-crypto-auth.test.mjs'
];
const result=spawnSync(process.execPath,['--test',...files],{
 cwd:root,encoding:'utf8',env:{...process.env,CI:'true'},timeout:180000
});
process.stdout.write(result.stdout||'');
process.stderr.write(result.stderr||'');
assert(result.status===0,'Phase 0 BLOCKED: PostgreSQL/cryptographic regression failed');
console.log('Phase 0 SOURCE/SCHEMA GATE: PASS.');
console.log('Production credential custody, live WebAuthn assertion and App installation permissions: NOT ATTESTED.');
