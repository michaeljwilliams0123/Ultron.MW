import { createHash } from 'node:crypto';
import { githubRequest } from './cloud-pr.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const ROOT='/repos/'+REPO;
const SHA=/^[a-f0-9]{40}$/;
const SLUG=/^[a-z][a-z0-9-]{2,30}$/;
const KINDS=new Set(['api','mcp']);
const OWNER='michaeljwilliams0123';

export function validateBuildIntent({kind,slug}={}) {
  if(!KINDS.has(kind)||!SLUG.test(slug||'')||
    slug.startsWith('ultron-')||slug.includes('--'))
    throw Error('Build type must be api or mcp and name must be a simple 3-31 letter identifier');
  return {kind,slug,operations:['status','ci'],authority:'read-only'};
}
function safeReadme(input){
  const {kind,slug}=input;
  return [
    '# Ultron generated '+kind.toUpperCase()+' connector: '+slug,'',
    'Autonomously generated on a PR branch. This does not deploy a persistent server.',
    'No local PC, paid inference provider, external secret, arbitrary shell, or workflow grant is required.',
    'Operations: read-only status and CI from the fixed Ultron public GitHub repository.',
    '',
    '## Credential boundary','',
    kind==='api'?
    'Hosting requires ULTRON_<NAME>_SIGNING_KEY stored as a protected environment secret. Use issueCapabilityToken() from src/capability-credentials.mjs inside your approved runtime; do not print, commit or embed key material in the Pages UI.':
    'MCP speaks JSON-RPC 2.0 over stdio. Its process identity and permissions belong to the host runtime; it does not mint GitHub access or request tokens.',
    'The GitHub Actions GITHUB_TOKEN is ephemeral and must stay within the workflow.',
    'Third-party provider tokens, OAuth consent and account secrets are not automatically issued by this generator.',
    '',
    '## Regression acceptance','',
    'Generated '+kind+' module and its generated test must pass node scripts/verify.mjs.',
    'The original PR branch must pass the exact-head Verify workflow before merge.',
    'A successful CI result is not proof of deployed endpoint availability.',
    '',
    'Source generated from deterministic, allowlisted templates and reviewed GitHub authority.',
    '',
  ].join('\n');
}
function generatedModule({kind,slug,operations}){
  const config=JSON.stringify({name:slug,kind,operations});
  if(kind==='api')return [
    "import { createApiHandler } from '../../framework-integration-runtime.mjs';",
    "export const integration = Object.freeze("+config+");",
    "export function createHandler({ signingKey,githubGet,now }={}) {",
    "  return createApiHandler(integration,{key:signingKey,githubGet,now});",
    "}",
    "",
  ].join('\n');
  return [
    "import { createMcpHandler } from '../../framework-integration-runtime.mjs';",
    "import { createInterface } from 'node:readline';",
    "import { pathToFileURL } from 'node:url';",
    "export const integration = Object.freeze("+config+");",
    "export function createHandler(options={}) { return createMcpHandler(integration,options); }",
    "if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {",
    "  const handle=createHandler();",
    "  const input=createInterface({input:process.stdin,crlfDelay:Infinity});",
    "  for await(const line of input) {",
    "    if(!line.trim())continue;",
    "    let reply;",
    "    try { reply=await handle(JSON.parse(line)); }",
    "    catch { reply={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}; }",
    "    if(reply)process.stdout.write(JSON.stringify(reply)+'\\n');",
    "  }",
    "}",
    "",
  ].join('\n');
}
function generatedTest({kind,slug}){
  const name=kind+'-'+slug;
  const ref='../src/generated/'+slug+'/'+kind+'.mjs';
  if(kind==='api')return [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { createHandler,integration } from '"+ref+"';",
    "import { createSigningKey,issueCapabilityToken } from '../src/capability-credentials.mjs';",
    "test('generated "+name+" exposes authenticated read-only operations',async()=>{",
    " const key=createSigningKey();",
    " const githubGet=async path=>path.endsWith('/actions/runs?per_page=3')?{workflow_runs:[]}:",
    "  {full_name:'michaeljwilliams0123/Ultron.MW',private:false,default_branch:'main'};",
    " const handle=createHandler({signingKey:key,githubGet,now:100});",
    " const token=issueCapabilityToken({key,audience:'"+slug+"',now:100,ttlSeconds:300,",
    "  scopes:['status:read','ci:read']});",
    " const unauth=await handle(new Request('https://example.test/v1/status'));",
    " assert.equal(unauth.status,401);",
    " const ok=await handle(new Request('https://example.test/v1/status',{headers:{",
    " authorization:'Bearer '+token}}));",
    " assert.equal(ok.status,200);",
    " assert.equal((await ok.json()).data.name,'michaeljwilliams0123/Ultron.MW');",
    " const ci=await handle(new Request('https://example.test/v1/ci',{headers:{",
    " authorization:'Bearer '+token}}));",
    " assert.equal(ci.status,200);",
    " const bad=await handle(new Request('https://example.test/execute',{method:'POST'}));",
    " assert.equal(bad.status,404);",
    " assert.equal(integration.kind,'api');",
    "});",
    "",
  ].join('\n');
  return [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { createHandler,integration } from '"+ref+"';",
    "test('generated "+name+" supports bounded MCP read tools',async()=>{",
    " const get=async path=>path.endsWith('/actions/runs?per_page=3')?{workflow_runs:[]}:",
    "  {full_name:'michaeljwilliams0123/Ultron.MW',private:false,default_branch:'main'};",
    " const handle=createHandler({githubGet:get});",
    " const init=await handle({jsonrpc:'2.0',id:1,method:'initialize'});",
    " assert.equal(init.result.serverInfo.name,'ultron-"+slug+"');",
    " const list=await handle({jsonrpc:'2.0',id:2,method:'tools/list'});",
    " assert.deepEqual(list.result.tools.map(t=>t.name),['ultron_status','ultron_ci']);",
    " const read=await handle({jsonrpc:'2.0',id:3,method:'tools/call',",
    "  params:{name:'ultron_status',arguments:{}}});",
    " assert.equal(read.result.isError,false);",
    " const denied=await handle({jsonrpc:'2.0',id:4,method:'tools/call',",
    "  params:{name:'ultron_shell',arguments:{}}});",
    " assert.equal(denied.error.code,-32602);",
    " assert.equal(integration.kind,'mcp');",
    "});",
    "",
  ].join('\n');
}
export function generateIntegrationFiles(request){
  const spec=validateBuildIntent(request);
  const {kind,slug}=spec;
  return [
    {path:'src/generated/'+slug+'/'+kind+'.mjs',content:generatedModule(spec)},
    {path:'test/generated-'+kind+'-'+slug+'.test.mjs',content:generatedTest(spec)},
    {path:'docs/integrations/'+slug+'-'+kind+'.md',content:safeReadme(spec)},
  ];
}
/** GitHub transaction: exact-head readback, no force, no main mutation. */
export async function buildFrameworkOnPr({pr,kind,slug,get,post,
  updateRef=(path,body)=>githubRequest(path,{method:'PATCH',body})}={}) {
  const request=validateBuildIntent({kind,slug});
  if(!pr || pr.state!=='open' || !SHA.test(pr.head?.sha||'') ||
    pr.base?.ref!=='main'||pr.head?.repo?.full_name!==REPO ||
    pr.base?.repo?.full_name!==REPO ||
    !pr.head?.ref?.startsWith('ultron/') ||
    typeof get!=='function'||typeof post!=='function'||typeof updateRef!=='function')
    throw Error('Framework generation requires current same-repository Ultron PR');
  const head=pr.head.sha,ref=pr.head.ref;
  const main=(await get(ROOT+'/git/ref/heads/main'))?.object?.sha;
  if(!SHA.test(main||''))throw Error('Cannot attest main');
  const compare=await get(ROOT+'/compare/'+main+'...'+head);
  if(compare?.merge_base_commit?.sha!==main||compare.behind_by!==0||
    !['ahead','identical'].includes(compare.status))
    throw Error('PR branch must contain current main before build');
  if((await get(ROOT+'/git/ref/heads/'+ref))?.object?.sha!==head)
    throw Error('PR source changed before build admission');
  const commit=await get(ROOT+'/git/commits/'+head);
  if(!SHA.test(commit?.tree?.sha||''))throw Error('PR source tree unavailable');
  const inventory=await get(ROOT+'/git/trees/'+commit.tree.sha+'?recursive=1');
  if(inventory?.truncated!==false||!Array.isArray(inventory?.tree)||
    inventory.tree.length>4096)throw Error('Cannot attest complete PR source tree');
  const files=generateIntegrationFiles(request);
  const existing=new Set(inventory.tree.map(x=>x.path));
  if(files.some(x=>existing.has(x.path)))
    throw Error('Integration files already exist; changes require a reviewed patch');
  if((await get(ROOT+'/git/ref/heads/main'))?.object?.sha!==main ||
    (await get(ROOT+'/git/ref/heads/'+ref))?.object?.sha!==head)
    throw Error('Repository source lease changed before build');
  const blobs=[];
  for(const file of files){
    const blob=await post(ROOT+'/git/blobs',{content:file.content,encoding:'utf-8'});
    if(!SHA.test(blob?.sha||''))throw Error('Generated source blob not verified');
    blobs.push({path:file.path,mode:'100644',type:'blob',sha:blob.sha});
  }
  const nextTree=await post(ROOT+'/git/trees',{base_tree:commit.tree.sha,tree:blobs});
  if(!SHA.test(nextTree?.sha||'')||nextTree.sha===commit.tree.sha)
    throw Error('Generated tree unchanged or unverified');
  const next=await post(ROOT+'/git/commits',{parents:[head],tree:nextTree.sha,
    message:'feat: generate '+kind+' integration '+slug+' from verified contract'});
  if(!SHA.test(next?.sha||''))throw Error('Generated commit unavailable');
  if((await get(ROOT+'/git/ref/heads/main'))?.object?.sha!==main ||
    (await get(ROOT+'/git/ref/heads/'+ref))?.object?.sha!==head)
    throw Error('Concurrent source change; no branch update');
  const updated=await updateRef(ROOT+'/git/refs/heads/'+ref,{sha:next.sha,force:false});
  if(updated?.object?.sha!==next.sha ||
    (await get(ROOT+'/git/ref/heads/'+ref))?.object?.sha!==next.sha)
    throw Error('Framework branch update not verified');
  for(const file of files){
    const check=await get(ROOT+'/contents/'+file.path+'?ref='+next.sha);
    if(check?.encoding!=='base64'||
      Buffer.from(check.content.replace(/\s/g,''),'base64').toString('utf8')!==file.content)
      throw Error('Generated integration file failed independent readback: '+file.path);
  }
  return {commitSha:next.sha,paths:files.map(x=>x.path),kind,slug,
    action:'generated',auth:'runtime-secret-reference-only',base:'main',
    regressionRequired:true};
}
