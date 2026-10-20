import { verifyCapabilityToken } from './capability-credentials.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const DEFAULT_TYPES=Object.freeze(['status','ci']);
const APPROVED=/^[a-z][a-z0-9-]{1,39}$/;

export function validateIntegrationConfig(config) {
  if(!config || typeof config!=='object' || Array.isArray(config)||
    !APPROVED.test(config.name||'') ||
    !['api','mcp'].includes(config.kind) ||
    !Array.isArray(config.operations) || config.operations.length<1 ||
    config.operations.length>2 || config.operations.some(x=>!DEFAULT_TYPES.includes(x)) ||
    new Set(config.operations).size!==config.operations.length)
    throw Error('Integration must use a bounded name, type and allowlisted operations');
  return Object.freeze({name:config.name,kind:config.kind,
    operations:Object.freeze([...config.operations]),
    repository:REPO, authority:'read-only'});
}
const publicGet=async path=>{
  // No configurable outbound domain or path. Public GitHub metadata only.
  if(!['/repos/'+REPO,'/repos/'+REPO+'/actions/runs?per_page=3'].includes(path))
    throw Error('Unapproved upstream API path');
  const response=await fetch('https://api.github.com'+path,{
    headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('GitHub read failed with HTTP '+response.status);
  return response.json();
};
async function runRead(operation,get=publicGet) {
  if(operation==='status') {
    const x=await get('/repos/'+REPO);
    if(x?.full_name!==REPO)throw Error('Repository identity not verified');
    return {name:x.full_name,visibility:x.visibility|| (x.private?'private':'public'),
      defaultBranch:x.default_branch||'main'};
  }
  if(operation==='ci') {
    const x=await get('/repos/'+REPO+'/actions/runs?per_page=3');
    if(!Array.isArray(x?.workflow_runs))throw Error('CI list unavailable');
    return {runs:x.workflow_runs.slice(0,3).map(r=>({
      id:r.id,sha:r.head_sha,conclusion:r.conclusion||null,status:r.status}))};
  }
  throw Error('Operation outside allowlist');
}
const json=(payload,status=200)=>new Response(JSON.stringify(payload),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
/** HTTP Request handler for a separately authorized cloud deployment. */
export function createApiHandler(config,{key,githubGet=publicGet,now}={}) {
  const c=validateIntegrationConfig(config);
  if(c.kind!=='api')throw Error('Wrong integration adapter');
  return async function handle(request) {
    try {
      const url=new URL(request.url);
      const op=url.pathname==='/v1/status'?'status':
        url.pathname==='/v1/ci'?'ci':null;
      if(request.method!=='GET'||!op||!c.operations.includes(op))
        return json({error:'not-found'},404);
      const auth=request.headers.get('authorization')||'';
      if(!auth.startsWith('Bearer ') || !verifyCapabilityToken(auth.slice(7),{
        key,audience:c.name,requiredScope:op+':read',now,
      }))return json({error:'unauthorized'},401);
      return json({integration:c.name,operation:op,
        verified:true,data:await runRead(op,githubGet)});
    }catch{return json({error:'upstream-unavailable'},503);}
  };
}
/** JSON-RPC/MCP protocol bridge, no subprocess, shell or filesystem tools. */
export function createMcpHandler(config,{githubGet=publicGet}={}) {
  const c=validateIntegrationConfig(config);
  if(c.kind!=='mcp')throw Error('Wrong integration adapter');
  return async function handle(message) {
    const id=message?.id;
    const reply=(result,error)=>id===undefined?null:{
      jsonrpc:'2.0',id,...(error?{error}:{result})};
    if(message?.jsonrpc!=='2.0'||typeof message.method!=='string')
      return reply(null,{code:-32600,message:'Invalid JSON-RPC request'});
    if(message.method==='notifications/initialized')return null;
    if(message.method==='initialize')return reply({
      protocolVersion:'2025-06-18',capabilities:{tools:{}},
      serverInfo:{name:'ultron-'+c.name,version:'1.0.0'}});
    if(message.method==='tools/list')
      return reply({tools:c.operations.map(op=>({
        name:'ultron_'+op,description:'Read-only Ultron '+op,
        inputSchema:{type:'object',properties:{},additionalProperties:false}}))});
    if(message.method==='tools/call') {
      const raw=message.params?.name;
      const op=typeof raw==='string'&&raw.startsWith('ultron_')?raw.slice(7):'';
      if(!c.operations.includes(op)||!message.params?.arguments ||
        Object.keys(message.params.arguments).length)
        return reply(null,{code:-32602,message:'Unadmitted tool or arguments'});
      try{return reply({content:[{type:'text',text:JSON.stringify(
        await runRead(op,githubGet))}],isError:false});}
      catch{return reply({content:[{type:'text',text:'Authenticated read unavailable'}],
        isError:true});}
    }
    return reply(null,{code:-32601,message:'Method not found'});
  };
}
