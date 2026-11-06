import {createGraphWorkbookReader} from 'lib/graph-workbook-read.js';

const ROOT='https://graph.microsoft.com/v1.0/me/drive/items/';
const KEY=/^[a-z0-9][a-z0-9_.:-]{7,127}$/i;
const held=reason=>({ok:false,status:'held',reason});
const uncertain=reason=>({ok:false,status:'reconcile-required',reason});

function scalar(value){
 return typeof value==='boolean' ||
  typeof value==='number' && Number.isFinite(value) ||
  typeof value==='string' && value.length<=8192 &&
   !/^[\s]*[=+\-@]/.test(value);
}
function copy(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid-request');
 const descriptors=Object.getOwnPropertyDescriptors(raw),result=Object.create(null);
 if(Object.keys(descriptors).sort().join(',')!=='cell,expectedBefore,key,value')
  throw Error('invalid-request');
 for(const [key,descriptor] of Object.entries(descriptors)){
  if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw Error('invalid-request');
  result[key]=descriptor.value;
 }
 if(typeof result.key!=='string'||!KEY.test(result.key)||
  typeof result.cell!=='string'||!scalar(result.expectedBefore)||!scalar(result.value))
  throw Error('invalid-request');
 return Object.freeze(result);
}
async function digest(value){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(JSON.stringify(value))));
 return [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

/**
 * Source-only adapter seam. The trusted runtime must implement an atomic,
 * durable one-shot claim tied to verified authority and a durable observation
 * receipt. Graph does not provide an atomic compare-and-set on this endpoint.
 */
export function createGraphWorkbookWriter({accountId,itemId,worksheetId,allowedCells,
 getDelegatedToken,claimDispatch,canDispatch,recordObservation,transport=fetch}={}){
 if(typeof getDelegatedToken!=='function'||typeof claimDispatch!=='function'||
  typeof canDispatch!=='function'||typeof recordObservation!=='function'||
  typeof transport!=='function')throw Error('graph-write-authority-unavailable');
 // Validate and snapshot trusted configuration before exposing the adapter.
 const cells=Array.isArray(allowedCells)?Object.freeze([...allowedCells]):allowedCells;
 createGraphWorkbookReader({accountId,itemId,worksheetId,allowedCells:cells,
  getDelegatedToken,transport});
 return Object.freeze({
  async writeCell(raw){
   let request;
   try{request=copy(raw);}catch{return held('invalid-request');}
   if(!cells.includes(request.cell))return held('graph-cell-not-admitted');
   let token;
   try{token=await getDelegatedToken();}catch{return held('graph-delegated-token-unavailable');}
   if(typeof token!=='string'||token.length<10||token.length>16384||/[\r\n]/.test(token))
    return held('graph-delegated-token-unavailable');
   const reader=createGraphWorkbookReader({accountId,itemId,worksheetId,allowedCells:cells,
    getDelegatedToken:async()=>token,transport});
   const before=await reader.readCell(request.cell);
   if(!before.ok)return held(before.error);
   if(!Object.is(before.value,request.expectedBefore))return held('graph-cell-precondition-mismatch');
   const fingerprint=await digest(['ultron.graph.cell.write.v1',accountId,itemId,worksheetId,
    request.key,request.cell,request.expectedBefore,request.value]);
   const claim=Object.freeze({key:request.key,operation:'graph.workbook.cell.write',fingerprint});
   let admitted;
   try{admitted=await claimDispatch(claim);}
   catch{return uncertain('dispatch-claim-unresolved');}
   if(admitted!==true)return held('dispatch-not-claimed');
   let allowed;
   try{allowed=await canDispatch(claim);}
   catch{return uncertain('dispatch-authority-unavailable');}
   if(allowed!==true)return uncertain('dispatch-authority-unavailable');
   let response;
   try{
    response=await transport(ROOT+encodeURIComponent(itemId)+'/workbook/worksheets/'+
     encodeURIComponent(worksheetId)+"/range(address='"+request.cell+"')",{
      method:'PATCH',redirect:'error',
      headers:{Authorization:'Bearer '+token,Accept:'application/json','Content-Type':'application/json'},
      body:JSON.stringify({values:[[request.value]]}),signal:AbortSignal.timeout(10000)
     });
   }catch{return uncertain('graph-write-outcome-unresolved');}
   if(response?.status!==200)return uncertain('graph-write-outcome-unresolved');
   const after=await reader.readCell(request.cell);
   if(!after.ok||!Object.is(after.value,request.value))
    return uncertain('graph-write-readback-unresolved');
   const evidence=Object.freeze({...claim,providerAcknowledged:true,readbackMatches:true});
   let recorded;
   try{recorded=await recordObservation(evidence);}
   catch{return uncertain('observation-receipt-unresolved');}
   if(recorded!==true)return uncertain('observation-receipt-unresolved');
   return {ok:true,status:'observed',key:request.key,fingerprint,
    providerAcknowledged:true,readbackMatches:true};
  },
 });
}
