import {createGraphWorkbookReader} from 'lib/graph-workbook-read.js';
import {createGraphWorkbookWriter} from 'lib/graph-workbook-write.js';
import {dataObject,providerBinding,grantRequest,authorizeProvider,reconcileProvider} from 'lib/mcp-provider-write.js';

const held=reason=>({ok:false,status:'held',reason});
function scalar(value){
 return typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||
  typeof value==='string'&&value.length<=8192&&!/^[\s]*[=+\-@]/.test(value);
}
async function bind(config,raw){
 const request=dataObject(raw);
 if(Object.keys(request).sort().join(',')!==
  'cell,expectedBefore,expectedProfileVersion,expectedStopVersion,key,value'||
  typeof request.cell!=='string'||!scalar(request.expectedBefore)||!scalar(request.value))
  throw Error('invalid-request');
 const rawConfig=await config.get('ULTRON_GRAPH_WORKBOOK_BINDING');
 if(typeof rawConfig!=='string'||rawConfig.length>8192)throw Error('binding-unavailable');
 const target=JSON.parse(rawConfig);
 if(!target||typeof target!=='object'||Array.isArray(target)||
  Object.keys(target).sort().join(',')!=='accountId,allowedCells,itemId,worksheetId')
  throw Error('binding-unavailable');
 createGraphWorkbookReader({...target,getDelegatedToken:async()=>null});
 if(!target.allowedCells.includes(request.cell))throw Error('cell-not-admitted');
 const binding=await providerBinding({key:request.key,operation:'graph.workbook.cell.write',
  target:[target.accountId,target.itemId,target.worksheetId,request.cell],
  payload:[request.expectedBefore,request.value],expectedProfileVersion:request.expectedProfileVersion,
  expectedStopVersion:request.expectedStopVersion});
 return {request,target,binding};
}
export async function graphWrite({mode,request,envelope,grantId,db,config}={}){
 if(typeof config?.get!=='function')return held('graph-binding-unavailable');
 let bound;
 try{bound=await bind(config,request);}catch{return held('invalid-request-or-binding');}
 if(mode==='prepare')return {ok:true,grantRequest:grantRequest(bound.binding)};
 if(mode==='reconcile')return reconcileProvider({db,binding:bound.binding,grantId});
 if(mode!=='submit')return held('invalid-mode');
 const authority=await authorizeProvider({db,config,binding:bound.binding,envelope});
 if(authority.error)return authority.error;
 const writer=createGraphWorkbookWriter({...bound.target,
  getDelegatedToken:()=>config.get('ULTRON_GRAPH_DELEGATED_TOKEN'),
  claimDispatch:()=>authority.claim(),canDispatch:()=>authority.canDispatch(),
  recordObservation:evidence=>authority.observe(evidence)});
 const result=await writer.writeCell({key:bound.request.key,cell:bound.request.cell,
  expectedBefore:bound.request.expectedBefore,value:bound.request.value});
 if(result.status==='observed')return authority.result();
 if(result.reason==='dispatch-not-claimed')return authority.result();
 return result;
}
