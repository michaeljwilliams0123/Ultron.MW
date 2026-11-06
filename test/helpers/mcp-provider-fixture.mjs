import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

const root=new URL('../../cloud/hatchable/',import.meta.url);
const url=file=>new URL(file,root).href;
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const load=async file=>readFile(new URL(file,root),'utf8');
const provider=data((await load('lib/mcp-provider-write.js'))
 .replace("'lib/security-adjudicator.js'",JSON.stringify(url('lib/security-adjudicator.js'))));
const reader=url('lib/graph-workbook-read.js');
const graphWriter=data((await load('lib/graph-workbook-write.js'))
 .replace("'lib/graph-workbook-read.js'",JSON.stringify(reader)));
export const graph=await import(data((await load('lib/mcp-graph-write.js'))
 .replace("'lib/graph-workbook-read.js'",JSON.stringify(reader))
 .replace("'lib/graph-workbook-write.js'",JSON.stringify(graphWriter))
 .replace("'lib/mcp-provider-write.js'",JSON.stringify(provider))));
export const github=await import(data((await load('lib/github-issue-write.js'))
 .replace("'lib/mcp-provider-write.js'",JSON.stringify(provider))));
export async function makeTool(file,dependency,source){
 return (await import(data((await load(file)).replace(dependency,JSON.stringify(source))))).default;
}
export const graphModule=data((await load('lib/mcp-graph-write.js'))
 .replace("'lib/graph-workbook-read.js'",JSON.stringify(reader))
 .replace("'lib/graph-workbook-write.js'",JSON.stringify(graphWriter))
 .replace("'lib/mcp-provider-write.js'",JSON.stringify(provider)));
export const githubModule=data((await load('lib/github-issue-write.js'))
 .replace("'lib/mcp-provider-write.js'",JSON.stringify(provider)));

export async function fixture({lostClaim=false,lostReceipt=false,denied=false,revoked=false}={}){
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const publicKey=JSON.stringify(await webcrypto.subtle.exportKey('jwk',pair.publicKey));
 const values={
  ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK:publicKey,
  ULTRON_GRAPH_WORKBOOK_BINDING:JSON.stringify({accountId:'owner-id',itemId:'item-id',
   worksheetId:'sheet-id',allowedCells:['A1']}),
  ULTRON_GRAPH_DELEGATED_TOKEN:'delegated-fixture-token',
  ULTRON_GITHUB_ISSUE_TOKEN:'github-fixture-token'
 };
 let row,claimCount=0;
 const db={async query(sql,p){
  if(sql.includes('FROM brain_mcp_provider_writes WHERE'))return {rows:row?[structuredClone(row)]:[]};
  if(sql.includes('INSERT INTO brain_mcp_provider_writes')){
   assertSql(sql,'clock_timestamp()', 'brain_authority_grants', 'brain_events', 'NOT paused');
   claimCount++;
   if(denied)return {rows:[]};
   if(row)return {rows:[]};
   row={action_key:p[0],operation:p[1],fingerprint:p[2],grant_id:p[3],
    resource_key:p[9],status:'reconcile-required',evidence:null};
   if(lostClaim)throw Error('claim acknowledgement lost');
   return {rows:[{id:1}]};
  }
  if(sql.includes(') AS admitted'))return {rows:[{admitted:!revoked}]};
  if(sql.includes("SET status='observed'")){
   row.status='observed';row.evidence=JSON.parse(p[3]);
   if(lostReceipt)throw Error('observation acknowledgement lost');
   return {rows:[{id:2}]};
  }
  throw Error('unexpected fixture SQL');
 }};
 const config={async get(key){return values[key];}};
 async function sign(claim,overrides={}){
  const now=Date.now();
  const payload=JSON.stringify({schema:'ultron.security-grant.v1',issuer:'ultron-independent-security',
   audience:'ultron-cloud-brain',grantId:'test-provider-grant',policySha:'a'.repeat(64),
   notBefore:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),
   ...claim,...overrides});
  const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,
   new TextEncoder().encode(payload));
  return {payload,signature:Buffer.from(signature).toString('base64url')};
 }
 return {db,config,values,sign,get claimCount(){return claimCount;},get row(){return row;}};
}
function assertSql(sql,...strings){
 for(const value of strings)if(!sql.includes(value))throw Error('SQL fixture missing '+value);
}
