#!/usr/bin/env node
/**
 * Exact-head Council owner-exception signer for security-sensitive PRs.
 * Usage:
 *   node scripts/council-owner-override.mjs --pr <number> [--reason "<text>"] [--key <path>] [--dry-run]
 */
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createPrivateKey,createPublicKey,randomBytes,sign,verify} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const REPO='michaeljwilliams0123/Ultron.MW';
const OWNER='michaeljwilliams0123';
const EXPECTED_REPO_ID=1424939667;
const REQUIRED_CHECKS=['test','fixed-comparison','attested-receipt','reef-runtime-probe'];

function arg(name,fallback=null){
 const idx=process.argv.indexOf(name);
 return idx>=0&&idx+1<process.argv.length?process.argv[idx+1]:fallback;
}
const hasFlag=name=>process.argv.includes(name);
function ghJson(endpoint){
 const out=execFileSync('gh',['api',endpoint],{encoding:'utf8'});
 return JSON.parse(out);
}

const prNumber=Number(arg('--pr','0'));
if(!Number.isSafeInteger(prNumber)||prNumber<1)throw Error('Valid --pr <number> is required');
const reason=arg('--reason','Owner-reviewed exact-head protected change, authorized after green CI');
if(!/^[ -~]{20,240}$/.test(reason))throw Error('Reason must be printable ASCII, 20-240 chars');
const keyPath=arg('--key',join(homedir(),'.ultron','keys','production-owner-20261108.private.jwk.json'));
const dryRun=hasFlag('--dry-run');

const who=execFileSync('gh',['api','user','--jq','.login'],{encoding:'utf8'}).trim();
if(who!==OWNER)throw Error('Primary GitHub owner authentication is required');

const pr=ghJson(`repos/${REPO}/pulls/${prNumber}`);
if(pr.state!=='open'||pr.draft||pr.base?.ref!=='main'||
  pr.head?.repo?.id!==EXPECTED_REPO_ID||pr.base?.repo?.id!==EXPECTED_REPO_ID||
  pr.user?.login!==OWNER)
 throw Error('Owner-authored open non-draft PR targeting main is required');

const head=String(pr.head?.sha||'');
const base=String(pr.base?.sha||'');
if(!/^[a-f0-9]{40}$/.test(head)||!/^[a-f0-9]{40}$/.test(base))
 throw Error('Invalid PR head/base SHA');

const checks=ghJson(`repos/${REPO}/commits/${head}/check-runs?per_page=100`);
if(Number(checks.total_count)>100)throw Error('Truncated CI inventory');
for(const name of REQUIRED_CHECKS){
 const latest=checks.check_runs.filter(c=>c.name===name)
  .sort((a,b)=>Date.parse(b.started_at)-Date.parse(a.started_at))[0];
 if(!latest||latest.status!=='completed'||latest.conclusion!=='success')
  throw Error(`Required exact-head check ${name} not successful`);
}

const pinned=JSON.parse(readFileSync(new URL('../config/council-owner-signing-key.json',import.meta.url),'utf8')).publicJwk;
const privJwk=JSON.parse(readFileSync(keyPath,'utf8'));
if(privJwk.x!==pinned.x||privJwk.y!==pinned.y)
 throw Error('Local private JWK does not match pinned config/council-owner-signing-key.json');

const nonce=randomBytes(16).toString('hex');
const payload=['ULTRON-COUNCIL-OVERRIDE-v1',REPO,String(prNumber),head,base,nonce,reason,''].join('\n');
const privKey=createPrivateKey({key:privJwk,format:'jwk'});
const pubKey=createPublicKey({key:pinned,format:'jwk'});
const sig=sign('sha256',Buffer.from(payload,'utf8'),{key:privKey,dsaEncoding:'der'}).toString('base64url');
if(!verify('sha256',Buffer.from(payload,'utf8'),{key:pubKey,dsaEncoding:'der'},Buffer.from(sig,'base64url')))
 throw Error('Local signature verification failed');

const comment=`/council override ${prNumber} ${head} ${base} ${nonce} -- ${reason}\nsignature:p256:${sig}`;
if(dryRun){
 console.log(comment);
 process.exit(0);
}
const posted=JSON.parse(execFileSync('gh',[
 'api','-X','POST',`repos/${REPO}/issues/${prNumber}/comments`,'-F','body=@-'
],{input:comment,encoding:'utf8'}));
console.log('SIGNED OWNER EXCEPTION POSTED:',posted.html_url);
