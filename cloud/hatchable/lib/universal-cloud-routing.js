import {MCP_CAPABILITIES} from './mcp-capability-registry.js';

const PROVIDERS=Object.freeze({
  gitlab:'gitlab.branch.create',
  graph:'graph.workbook.cell.write',
});
const GRANT=/^[A-Za-z0-9_.:-]{8,128}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const PASSKEY=/^passkey-[A-Za-z0-9-]{16,96}$/;
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
/** A routing contract only. Provider-specific engines enforce real crypto,
 * allowed scope, PostgreSQL claim, pause fencing, and fresh provider readback.
 * No caller-supplied verified/authorized/permission flag is accepted.
 */
export function normalizeUniversalCloudCommand(body){
  const operation=PROVIDERS[body?.provider];
  if(!operation || !MCP_CAPABILITIES.some(c=>
    c.operation===operation&&c.effect==='external-write'&&
    c.admission.includes('signed-grant')))
    return held('provider-not-certified-for-universal-write');
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
    request:body.request,
    ...(extra==='envelope'?{envelope:body.envelope}:{}),
    ...(extra==='passkey'?{passkey:body.passkey}:{}),
    ...(extra==='grantId'?{grantId:body.grantId}:{})});
}
