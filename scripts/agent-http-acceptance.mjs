#!/usr/bin/env node
// Read-only release evidence, not release authorization or provider metering.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildAgentDocs, buildCrawlerPolicy } from './build-agent-docs.mjs';

const targets = Object.freeze({
  origin: 'https://ultron-mw-cloud.hatchable.site',
  edge: 'https://ultron-edge-shield.mahoraga-mjw0123.workers.dev',
});
const perRequestReservation = 65536;
const maxBody = 16384;
const discovery = ['ucp','oauth-authorization-server','api-catalog','http-message-signatures-directory'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const types = path => path.endsWith('.md') ? ['text/markdown'] : path.endsWith('.xml') ? ['application/xml','text/xml'] : path.endsWith('.html') ? ['text/html'] : ['text/plain'];

// Bind the CLI to the repository containing this script, not an arbitrary cwd.
export function assertCleanSource(expectedSha, root=fileURLToPath(new URL('../', import.meta.url))) {
  const git = (...args) => execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if (git('rev-parse','--is-inside-work-tree') !== 'true' || git('rev-parse','--show-prefix') !== '') throw Error('source-root-mismatch');
  const sha = git('rev-parse','HEAD');
  if (sha !== expectedSha) throw Error('source-mismatch');
  if (git('status','--porcelain=v1','--untracked-files=all','--ignore-submodules=none')) throw Error('dirty-source');
  return sha;
}
const evidenceHeaders = ['cache-control','x-robots-tag','vary','retry-after','x-content-type-options'];
function selectEvidenceHeaders(headers) {
  return Object.fromEntries(evidenceHeaders.flatMap(name => {
    const value=headers.get(name);
    return value===null?[]:[[name,value.slice(0,256)]];
  }));
}

export function acceptancePlan() {
  const docs = {...buildAgentDocs(),'robots.txt':buildCrawlerPolicy()};
  return [
    ...Object.entries(docs).map(([path, body]) => ({path:'/'+path, method:'GET', kind:'doc', types:types(path), expectedDigest:digest(Buffer.from(body))})),
    ...discovery.flatMap(name => ['GET','HEAD'].map(method=>({path:'/.well-known/'+name,method,kind:'unsupported'}))),
    {path:'/api/brain/control',method:'GET',kind:'protected'},
  ];
}
async function boundedBody(response) {
  if (!response.body) return Buffer.alloc(0);
  const rawLength = response.headers.get('content-length');
  if (rawLength !== null && Number(rawLength) > maxBody) {
    await response.body.cancel();
    throw Error('body-limit');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBody) {
        await reader.cancel();
        throw Error('body-limit');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
export async function runAgentAcceptance({target, budgetBytes, sourceSha, deployment, fetcher=fetch}) {
  if (!Object.hasOwn(targets,target) || !Number.isSafeInteger(budgetBytes) || budgetBytes < 0 || budgetBytes > 2000000 || !/^[a-f0-9]{40}$/.test(sourceSha||'') || !/^[A-Za-z0-9._:-]{1,100}$/.test(deployment||'')) throw Error('invalid-probe-configuration');
  const plan = acceptancePlan();
  const reservedBytes = plan.length * perRequestReservation;
  const result = {schema:'ultron.agent-http-acceptance.v1',target,sourceSha,claimedDeployment:deployment,deploymentIdentityVerified:false,providerMeterVerified:false,reservedBytes,requested:0,decodedBodyBytes:0,checks:[],status:'held',reason:null};
  if (budgetBytes < reservedBytes) { result.reason='insufficient-budget'; return result; }
  for (const item of plan) {
    const check={path:item.path,method:item.method,status:null,passed:false};
    result.checks.push(check);
    result.requested++;
    try {
      const response=await fetcher(targets[target]+item.path,{
        method:item.method,redirect:'manual',credentials:'omit',cache:'no-store',
        headers:{accept:item.kind==='doc'?item.types.join(', '):'application/json','accept-encoding':'identity'},
        signal:AbortSignal.timeout(8000),
      });
      check.status=response.status;
      check.headers=selectEvidenceHeaders(response.headers);
      check.contentType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      if (response.status===429 || response.status>=500 || ([401,403].includes(response.status)&&item.kind!=='protected')) {
        await response.body?.cancel();
        result.reason='remote-hold-'+response.status;
        return result;
      }
      if (item.kind==='protected') {
        check.passed=[401,403].includes(response.status);
        await response.body?.cancel();
      } else if (response.status!==(item.kind==='doc'?200:404)) {
        await response.body?.cancel();
      } else {
        const bytes=await boundedBody(response);
        result.decodedBodyBytes+=bytes.length;
        check.bodySha256=digest(bytes);
        if (item.kind==='doc') {
          check.passed=item.types.includes(check.contentType)&&check.bodySha256===item.expectedDigest;
        } else {
          check.passed=check.contentType==='application/json'&&/\bno-store\b/i.test(response.headers.get('cache-control')||'')&&/\bnoindex\b/i.test(response.headers.get('x-robots-tag')||'')&& (item.method==='HEAD'?bytes.length===0:bytes.toString('utf8')==='{"error":"not_found"}');
        }
      }
    } catch(e) {
      result.reason=e?.message==='body-limit'?'body-limit':'transport-unavailable';
      return result;
    }
    if (!check.passed) {result.status='failed';result.reason='contract-mismatch';return result;}
  }
  result.status='passed-http-contract';
  return result;
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const argv=process.argv.slice(2);
    const fields=['--target','--budget-bytes','--source-sha','--deployment'];
    if(argv.length!==8||new Set(argv.filter((_,i)=>i%2===0)).size!==4||argv.filter((_,i)=>i%2===0).some(k=>!fields.includes(k)))throw Error('required: --target origin|edge --budget-bytes N --source-sha SHA --deployment VERSION');
    const args=Object.fromEntries(fields.map(k=>[k,argv[argv.indexOf(k)+1]]));
    if(!/^\d+$/.test(args['--budget-bytes']))throw Error('invalid-budget');
    const sha=assertCleanSource(args['--source-sha']);
    const report=await runAgentAcceptance({target:args['--target'],budgetBytes:Number(args['--budget-bytes']),sourceSha:sha,deployment:args['--deployment']});
    console.log(JSON.stringify({...report,sourceCheckoutVerified:true},null,2));
    if(report.status!=='passed-http-contract')process.exitCode=1;
  } catch {console.error('Agent acceptance held: invalid source, target, deployment, or budget.');process.exitCode=1;}
}
