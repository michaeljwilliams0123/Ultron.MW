#!/usr/bin/env node
/**
 * Exact-head Council owner-exception signer for security-sensitive PRs.
 * Usage:
 *   node scripts/council-owner-override.mjs --pr <number> [--expected-head SHA --expected-base SHA] [--reason "<text>"] [--key <path>] [--dry-run]
 */
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createPrivateKey,createPublicKey,randomBytes,sign,verify} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {assertOwnerOverrideAdmission} from '../src/council-owner-signing-admission.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';

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

function readAdmission(expectedHead,expectedBase){
 const principal=ghJson('user');
 const pr=ghJson(`repos/${REPO}/pulls/${prNumber}`);
 if(pr.number!==prNumber)throw Error('Unexpected PR number');
 // Fetch every page from GitHub; never infer approval from a PR comment.
 const pages=JSON.parse(execFileSync('gh',['api','--paginate','--slurp',
  `repos/${REPO}/pulls/${prNumber}/reviews?per_page=100`],{encoding:'utf8'}));
 if(!Array.isArray(pages)||!pages.every(Array.isArray))throw Error('Review inventory unavailable');
 const checks=ghJson(`repos/${REPO}/commits/${pr.head?.sha}/check-runs?per_page=100`);
 return assertOwnerOverrideAdmission({principal,pr,reviews:pages.flat(),checks,expectedHead,expectedBase});
}
const {head,base}=readAdmission(arg('--expected-head'),arg('--expected-base'));

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
// A second authenticated snapshot must still satisfy the original target.
readAdmission(head,base);
const posted=JSON.parse(execFileSync('gh',[
 'api','-X','POST',`repos/${REPO}/issues/${prNumber}/comments`,'-F','body=@-'
],{input:comment,encoding:'utf8'}));
console.log('SIGNED OWNER EXCEPTION POSTED:',posted.html_url);
