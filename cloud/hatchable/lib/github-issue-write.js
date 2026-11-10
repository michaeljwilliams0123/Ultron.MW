import {dataObject,providerBinding,grantRequest,authorizeProvider,reconcileProvider} from 'lib/mcp-provider-write.js';

const ROOT='https://api.github.com/repos/Ultron-MW/Ultron.MW/issues/';
const held=reason=>({ok:false,status:'held',reason});
const uncertain=reason=>({ok:false,status:'reconcile-required',reason});
async function bind(raw){
 const request=dataObject(raw);
 if(!['body,expectedProfileVersion,expectedStopVersion,issueNumber,key',
  'body,expectedProfileVersion,expectedStopVersion,issueNumber,key,state']
  .includes(Object.keys(request).sort().join(','))||
  !Number.isSafeInteger(request.issueNumber)||request.issueNumber<1||request.issueNumber>1000000000||
  typeof request.body!=='string'||request.body.length>12000||
  (request.state!==undefined&&!['open','closed'].includes(request.state)))
  throw Error('invalid-request');
 const binding=await providerBinding({key:request.key,operation:'github.issue.write',
  target:['Ultron-MW/Ultron.MW',request.issueNumber],
  payload:[request.body,request.state??null],expectedProfileVersion:request.expectedProfileVersion,
  expectedStopVersion:request.expectedStopVersion});
 return {request,binding};
}
async function readIssue(transport,url,headers,number){
 const response=await transport(url,{method:'GET',headers,redirect:'error',
  signal:AbortSignal.timeout(10000)});
 if(!response?.ok||typeof response.body?.getReader!=='function')throw Error('github-read-unavailable');
 const length=response.headers?.get('content-length');
 if(length!==null&&length!==undefined&&(!/^\d+$/.test(length)||Number(length)>131072))
  throw Error('github-response-too-large');
 const reader=response.body.getReader(),chunks=[];
 let size=0;
 while(true){
  const {done,value}=await reader.read();
  if(done)break;
  size+=value.byteLength;
  if(size>131072){await reader.cancel();throw Error('github-response-too-large');}
  chunks.push(value);
 }
 const bytes=new Uint8Array(size);
 let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const issue=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(issue?.number!==number||issue.pull_request||
  !(typeof issue.body==='string'||issue.body===null)||
  !['open','closed'].includes(issue.state)||
  issue.html_url!=='https://github.com/Ultron-MW/Ultron.MW/issues/'+number)
  throw Error('github-response-invalid');
 return issue;
}
function publicResult(result,expectedNumber){
 if(result?.status!=='observed')return result;
 const issueNumber=result.evidence?.issueNumber;
 if(!Number.isSafeInteger(issueNumber)||issueNumber!==expectedNumber)
  return uncertain('invalid-receipt');
 return {...result,issueUrl:'https://github.com/Ultron-MW/Ultron.MW/issues/'+issueNumber};
}
export async function githubIssueWrite({mode,request,envelope,grantId,db,config,transport=fetch}={}){
 let bound;
 try{bound=await bind(request);}catch{return held('invalid-request');}
 if(mode==='prepare')return {ok:true,grantRequest:grantRequest(bound.binding)};
 if(mode==='reconcile')return publicResult(await reconcileProvider({db,binding:bound.binding,grantId}),
  bound.request.issueNumber);
 if(mode!=='submit')return held('invalid-mode');
 const authority=await authorizeProvider({db,config,binding:bound.binding,envelope});
 if(authority.error)return publicResult(authority.error,bound.request.issueNumber);
 let token;
 try{token=await config.get('ULTRON_GITHUB_ISSUE_TOKEN');}
 catch{return held('github-token-unavailable');}
 if(typeof token!=='string'||token.length<10||token.length>16384||/[\r\n]/.test(token))
  return held('github-token-unavailable');
 const url=ROOT+bound.request.issueNumber;
 const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
  'User-Agent':'UltronMW-Cloud-Brain',Authorization:'Bearer '+token};
 try{await readIssue(transport,url,headers,bound.request.issueNumber);}
 catch{return held('github-issue-preflight-unavailable');}
 let claimed;
 try{claimed=await authority.claim();}catch{return uncertain('dispatch-claim-unresolved');}
 if(claimed!==true)return uncertain('dispatch-not-claimed');
 try{if(!await authority.canDispatch())return uncertain('dispatch-authority-unavailable');}
 catch{return uncertain('dispatch-authority-unavailable');}
 let response;
 try{response=await transport(url,{method:'PATCH',redirect:'error',
  headers:{...headers,'Content-Type':'application/json'},
  body:JSON.stringify({body:bound.request.body,
   ...(bound.request.state===undefined?{}:{state:bound.request.state})}),
  signal:AbortSignal.timeout(10000)});}
 catch{return uncertain('github-write-outcome-unresolved');}
 if(response?.status!==200)return uncertain('github-write-outcome-unresolved');
 let issue;
 try{issue=await readIssue(transport,url,headers,bound.request.issueNumber);}
 catch{return uncertain('github-readback-unavailable');}
 if(issue.body!==bound.request.body||
  bound.request.state!==undefined&&issue.state!==bound.request.state)
  return uncertain('github-readback-mismatch');
 try{
  if(!await authority.observe({providerAcknowledged:true,readbackMatches:true,
   issueNumber:issue.number,state:issue.state}))return uncertain('observation-receipt-unresolved');
 }catch{return uncertain('observation-receipt-unresolved');}
 return publicResult(await authority.result(),bound.request.issueNumber);
}
