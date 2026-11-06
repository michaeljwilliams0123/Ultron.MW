// Trusted runtime wiring must supply the account, workbook, worksheet and
// delegated token provider. Tool arguments cannot configure these values.
const ROOT='https://graph.microsoft.com/v1.0';
const IDENTIFIER=/^[A-Za-z0-9_!{}-]{1,200}$/;
const MAX_BYTES=65536;

function validCell(cell){
 if(typeof cell!=='string')return false;
 const match=/^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(cell);
 if(!match||Number(match[2])>1048576)return false;
 return [...match[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)<=16384;
}
async function json(transport,url,token){
 const response=await transport(url,{method:'GET',redirect:'error',
  headers:{Authorization:'Bearer '+token,Accept:'application/json'},
  signal:AbortSignal.timeout(10000)});
 if(!response?.ok)throw Error('graph-request-failed');
 const length=response.headers?.get('content-length');
 if(length!=null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES))
  throw Error('graph-response-too-large');
 if(typeof response.body?.getReader!=='function')throw Error('graph-response-unavailable');
 const reader=response.body.getReader(),chunks=[];
 let size=0;
 while(true){
  const {done,value}=await reader.read();
  if(done)break;
  size+=value.byteLength;
  if(size>MAX_BYTES){await reader.cancel();throw Error('graph-response-too-large');}
  chunks.push(value);
 }
 const bytes=new Uint8Array(size);
 let index=0;
 for(const chunk of chunks){bytes.set(chunk,index);index+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 catch{throw Error('graph-response-invalid');}
}

export function createGraphWorkbookReader({accountId,itemId,worksheetId,allowedCells,
 getDelegatedToken,transport=fetch}={}){
 if(!IDENTIFIER.test(accountId||'')||!IDENTIFIER.test(itemId||'')||
  !IDENTIFIER.test(worksheetId||'')||!Array.isArray(allowedCells)||
  !allowedCells.length||allowedCells.length>100||
  allowedCells.some(cell=>!validCell(cell))||
  new Set(allowedCells).size!==allowedCells.length||
  typeof getDelegatedToken!=='function'||typeof transport!=='function')
  throw Error('graph-workbook-binding-invalid');
 const cells=new Set(allowedCells);
 return Object.freeze({
  async readCell(cell){
   if(!validCell(cell)||!cells.has(cell))return {ok:false,error:'graph-cell-not-admitted'};
   let token;
   try{token=await getDelegatedToken();}
   catch{return {ok:false,error:'graph-delegated-token-unavailable'};}
   if(typeof token!=='string'||token.length<10||token.length>16384||
    /[\r\n]/.test(token))return {ok:false,error:'graph-delegated-token-unavailable'};
   let me,range;
   try{
    me=await json(transport,ROOT+'/me?$select=id',token);
    if(me?.id!==accountId)return {ok:false,error:'graph-account-mismatch'};
    range=await json(transport,ROOT+'/me/drive/items/'+encodeURIComponent(itemId)+
     '/workbook/worksheets/'+encodeURIComponent(worksheetId)+
     "/range(address='"+cell+"')?$select=values",token);
   }catch{return {ok:false,error:'graph-read-unavailable'};}
   const values=range?.values;
   if(!Array.isArray(values)||values.length!==1||!Array.isArray(values[0])||
    values[0].length!==1)return {ok:false,error:'graph-response-invalid'};
   const value=values[0][0];
   if(!(typeof value==='boolean'||typeof value==='string'&&value.length<=8192||
    typeof value==='number'&&Number.isFinite(value)))
    return {ok:false,error:'graph-response-invalid'};
   return {ok:true,cell,value};
  },
 });
}
