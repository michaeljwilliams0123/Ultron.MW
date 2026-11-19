import {MCP_CAPABILITIES} from './mcp-capability-registry.js';

const PROVIDERS=Object.freeze({
  gitlab:'gitlab.branch.create',
  graph:'graph.workbook.cell.write',
});
const GRANT=/^[A-Za-z0-9_.:-]{8,128}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const PASSKEY=/^passkey-[A-Za-z0-9-]{16,96}$/;
const VERSION=/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const held=reason=>({ok:false,status:'held',reason});
function exact(value,fields){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  try{
    const descriptors=Object.getOwnPropertyDescriptors(value);
    const keys=Reflect.ownKeys(descriptors);
    return keys.length===fields.length &&
      keys.every(key=>typeof key==='string'&&fields.includes(key)&&
        descriptors[key].enumerable&&Object.hasOwn(descriptors[key],'value'));
  }catch{return false;}
}
function validSignedEnvelope(value){
  return exact(value,['payload','signature'])&&
    typeof value.payload==='string'&&value.payload.length>0&&
    value.payload.length<=4096&&SIG.test(value.signature||'');
}
function validPasskey(value){
  return exact(value,['grantId','credentialId','authenticatorData',
    'clientDataJSON','signature'])&&PASSKEY.test(value.grantId||'')&&
    ['credentialId','authenticatorData','clientDataJSON','signature'].every(
      key=>typeof value[key]==='string'&&value[key].length>=16&&
       value[key].length<=8192);
}
export function evaluateAdapterConfig(provider,adapterConfigRaw){
  if(adapterConfigRaw===undefined||adapterConfigRaw===null||
     (typeof adapterConfigRaw==='string'&&adapterConfigRaw.trim()===''))
    return {ok:true,adapterVersion:null,rolledBack:false};
  let parsed=adapterConfigRaw;
  if(typeof adapterConfigRaw==='string'){
    try{parsed=JSON.parse(adapterConfigRaw);}catch{
      return held('adapter-registry-config-invalid');
    }
  }
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
    return held('adapter-registry-config-invalid');
  if(!Object.hasOwn(parsed,provider))
    return {ok:true,adapterVersion:null,rolledBack:false};
  const entry=parsed[provider];
  if(!entry||typeof entry!=='object'||Array.isArray(entry))
    return held('adapter-registry-config-invalid');
  if(entry.maxCostCents!==undefined&&entry.maxCostCents!==0)
    return held('adapter-registry-config-invalid');
  if(entry.enabled===false)
    return held('adapter-disabled-by-config');
  const target=entry.rollbackTo!==undefined?entry.rollbackTo:entry.version;
  if(target!==undefined&&(typeof target!=='string'||!VERSION.test(target)))
    return held('adapter-registry-config-invalid');
  return {
    ok:true,
    adapterVersion:typeof target==='string'?target:null,
    rolledBack:entry.rollbackTo!==undefined,
  };
}
/** A routing contract only. Provider-specific engines enforce real crypto,
 * allowed scope, PostgreSQL claim, pause fencing, and fresh provider readback.
 * No caller-supplied verified/authorized/permission flag is accepted.
 */
export function normalizeUniversalCloudCommand(body,{adapterConfigRaw=null}={}){
  const operation=PROVIDERS[body?.provider];
  if(!operation || !MCP_CAPABILITIES.some(c=>
    c.operation===operation&&c.effect==='external-write'&&
    c.admission.includes('signed-grant')))
    return held('provider-not-certified-for-universal-write');
  const adapter=evaluateAdapterConfig(body.provider,adapterConfigRaw);
  if(!adapter.ok)return adapter;
  if(!body||typeof body!=='object'||Array.isArray(body)||
     body.estimatedCostCents!==0||
     !body.request||typeof body.request!=='object'||
     Array.isArray(body.request))return held('zero-cost-or-request-invalid');
  const mode=body.mode;
  const extra=mode==='submit'?
    (Object.hasOwn(body,'envelope')?'envelope':
      Object.hasOwn(body,'passkey')?'passkey':null):
    mode==='reconcile'?'grantId':null;
  const fields=['provider','mode','estimatedCostCents','request',
    ...(extra?[extra]:[])];
  if(!['prepare','submit','reconcile'].includes(mode)||!exact(body,fields))
    return held('invalid-universal-command-fields');
  if(mode==='submit'){
    if(extra==='envelope'&&!validSignedEnvelope(body.envelope))
      return held('owner-signature-required');
    if(extra==='passkey'&&(body.provider!=='gitlab'||!validPasskey(body.passkey)))
      return held('unsupported-passkey-grant');
    if(!extra)return held('owner-grant-required');
  }
  if(mode==='reconcile'&&!GRANT.test(body.grantId||''))
    return held('invalid-reconciliation-id');
  return Object.freeze({ok:true,provider:body.provider,operation,mode,
    adapterVersion:adapter.adapterVersion,rolledBack:adapter.rolledBack,
    request:body.request,
    ...(extra==='envelope'?{envelope:body.envelope}:{}),
    ...(extra==='passkey'?{passkey:body.passkey}:{}),
    ...(extra==='grantId'?{grantId:body.grantId}:{})});
}
