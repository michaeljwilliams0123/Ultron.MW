// Fixed public repository and endpoint; no caller-provided URL or credential.
const ROOT='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/issues/';
const MAX_BYTES=65536;
export async function readGithubIssue(number,{transport=fetch}={}){
 if(!Number.isSafeInteger(number)||number<1||number>1000000000)
  return {ok:false,error:'invalid-issue-number'};
 let response;
 try{
  response=await transport(ROOT+number,{method:'GET',redirect:'error',
   headers:{Accept:'application/vnd.github+json','User-Agent':'UltronMW-Cloud-Brain'},
   signal:AbortSignal.timeout(10000)});
 }catch{return {ok:false,error:'github-read-unavailable'};}
 if(!response?.ok)return {ok:false,error:'github-read-failed',status:response?.status??null};
 const declared=response.headers?.get('content-length');
 if(declared!==null&&declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BYTES))
  return {ok:false,error:'github-response-too-large'};
 if(!response.body||typeof response.body.getReader!=='function')
  return {ok:false,error:'github-response-unavailable'};
 const reader=response.body.getReader(),chunks=[];
 let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>MAX_BYTES){
    await reader.cancel();
    return {ok:false,error:'github-response-too-large'};
   }
   chunks.push(value);
  }
 }catch{return {ok:false,error:'github-response-unavailable'};}
 let issue;
 try{
  const all=new Uint8Array(size);
  let offset=0;
  for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
  issue=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
 }catch{return {ok:false,error:'github-response-invalid'};}
 if(issue?.number!==number||issue.pull_request||
  typeof issue.title!=='string'||!['open','closed'].includes(issue.state)||
  typeof issue.updated_at!=='string')
  return {ok:false,error:'github-response-invalid'};
 return {ok:true,issue:{number:issue.number,title:issue.title.slice(0,256),
  state:issue.state,updatedAt:issue.updated_at}};
}
