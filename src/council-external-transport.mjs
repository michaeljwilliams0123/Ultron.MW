/** C04 direct read transport for a separately authorized server worker.
 * Public web: pinned HTTPS DNS resolution, no redirects/credentials/private IPs.
 * Mahoraga: GitHub installation-token readback and exact-SHA file read.
 * No writes, billing, browser cookie/profile access or secret logging.
 */
import {isIP} from 'node:net';
import {request as nodeHttpsRequest} from 'node:https';
import {lookup as nodeDnsLookup} from 'node:dns/promises';
const REPO='michaeljwilliams0123/mahoraga';
const SHA=/^[a-f0-9]{40}$/;
const PATH=/^(src|test|docs|scripts|evaluation|cloud-app|deploy)\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const MAX_BYTES=65536;
function fail(code){throw Error('external-transport-'+code);}
export function publicIPv4(address){
 if(isIP(address)!==4)return false;
 const [a,b,c,d]=address.split('.').map(Number);
 if([a,b,c,d].some(x=>x<0||x>255))return false;
 if(a===0||a===10||a===127||a>=224||a===169&&b===254||
  a===172&&b>=16&&b<=31||a===192&&b===168||
  a===100&&b>=64&&b<=127||a===198&&b>=18&&b<=19||
  a===192&&b===0&&(c===0||c===2)||a===192&&b===88&&c===99||
  a===198&&b===51&&c===100||
  a===203&&b===0&&c===113||a===255)return false;
 return true;
}
function webUrl(value){
 let url;
 try{url=new URL(value);}catch{fail('url-invalid');}
 const host=url.hostname;
 if(url.protocol!=='https:'||url.username||url.password||url.port||
  url.hash||!host||isIP(host)||host.includes(':')||
  /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host)||
  !/^[a-z0-9.-]+$/i.test(host)||!host.includes('.')||host.endsWith('.'))
  fail('url-invalid');
 return url;
}
async function githubJson(url,token,fetchImpl){
 const response=await fetchImpl(url,{
  method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),
  headers:{accept:'application/vnd.github+json',
   authorization:'Bearer '+token,'x-github-api-version':'2022-11-28'}
 });
 if(response.status!==200)fail('github-read-unavailable');
 const bytes=await response.text();
 if(Buffer.byteLength(bytes)>1024*1024)fail('github-response-too-large');
 try{return JSON.parse(bytes);}catch{fail('github-json-invalid');}
}
function githubPath(params){
 if(!params||params.repository!==REPO||!SHA.test(params.sourceSha??'')||
  typeof params.path!=='string'||!PATH.test(params.path)||
  params.path.split('/').some(part=>part==='.'||part==='..'))
  fail('peer-target-invalid');
}
export function makeCouncilExternalTransport({
 dnsResolve,httpsRequest,githubInstallationToken,fetchImpl,totalTimeoutMs=15000
}={}){
 if(!Number.isSafeInteger(totalTimeoutMs)||totalTimeoutMs<1||totalTimeoutMs>15000)
  fail('timeout-policy-invalid');
 return Object.freeze({
  async webRead(params={}){
   if(typeof dnsResolve!=='function'||typeof httpsRequest!=='function')
    fail('unconfigured');
   if(params.method!=='GET'||params.redirect!=='manual'||
     params.requirePublicIpAtConnection!==true||
     !Number.isSafeInteger(params.maxBytes)||params.maxBytes<1||
     params.maxBytes>MAX_BYTES)fail('web-policy-invalid');
   const url=webUrl(params.url);
   const addresses=await dnsResolve(url.hostname,{family:4,all:true});
   if(!Array.isArray(addresses)||!addresses.length||
     addresses.some(x=>x.family!==4||!publicIPv4(x.address)))
     fail('private-egress');
   // Pin the validated IPv4 for the TLS connection. A later DNS query must
   // NOT replace the chosen IP (rebinding). TLS still verifies the hostname.
   const pinned=addresses[0].address;
   return new Promise((resolve,reject)=>{
    let done=false,total=0,deadline;
    const finish=(error,value)=>{
     if(done)return;
     done=true;
     clearTimeout(deadline);
     if(error)reject(error);else resolve(value);
    };
    let request;
    try{
     request=httpsRequest(url,{
      method:'GET',timeout:10000,maxHeaderSize:16384,
      headers:{accept:'text/html,text/plain,application/json',
       'user-agent':'ultron-council-public-research/1.0'},
      lookup:(_host,_options,callback)=>callback(null,pinned,4)
     },res=>{
      const type=String(res.headers['content-type']??'').split(';')[0].trim().toLowerCase();
      if(res.statusCode!==200||!['text/html','text/plain','application/json'].includes(type)){
       res.resume();
       return finish(Error('external-transport-response-invalid'));
      }
      const parts=[];
      res.on('data',chunk=>{
       total+=chunk.length;
       if(total>params.maxBytes){
        res.destroy();
        finish(Error('external-transport-response-too-large'));
       }else parts.push(chunk);
      });
      res.on('error',err=>finish(err));
      res.on('end',()=>finish(null,{
       status:200,finalUrl:url.href,contentType:type,
       body:Buffer.concat(parts).toString('utf8'),
       egressVerified:true,redirected:false
      }));
     });
     if(!done)deadline=setTimeout(()=>request.destroy(Error('external-transport-timeout')),totalTimeoutMs);
     request.on('close',()=>clearTimeout(deadline));
     request.on('timeout',()=>request.destroy(Error('external-transport-timeout')));
     request.on('error',e=>finish(e));
     request.end();
    }catch(e){finish(e);}
   });
  },
  async githubRead(params={}){
   githubPath(params);
   if(typeof githubInstallationToken!=='string'||
      githubInstallationToken.length<12||typeof fetchImpl!=='function')
     fail('unconfigured');
   if(params.requiredPermission&&params.requiredPermission!=='contents:read')
     fail('github-permission-invalid');
   if(params.requireDistinctRepositoryInstallation===false)
     fail('peer-access-required');
   if(!Number.isSafeInteger(params.expectedInstallationId)||
      params.expectedInstallationId<1)fail('installation-identity-unverified');
   const identity=await githubJson('https://api.github.com/installation',
     githubInstallationToken,fetchImpl);
   if(identity?.id!==params.expectedInstallationId||
      !Number.isSafeInteger(identity.app_id)||identity.app_id<1)
     fail('installation-identity-mismatch');
   // GitHub, not caller text, is the authority for installed repo scope.
   let permitted=false;
   for(let page=1;page<=5;page++){
    const data=await githubJson(
     'https://api.github.com/installation/repositories?per_page=100&page='+page,
     githubInstallationToken,fetchImpl);
    if(!Array.isArray(data.repositories))fail('github-json-invalid');
    if(data.repositories.some(r=>r?.full_name===REPO)){permitted=true;break;}
    if(data.repositories.length<100)break;
   }
   if(!permitted)fail('peer-not-installed');
   const file=await githubJson('https://api.github.com/repos/'+REPO+
    '/contents/'+params.path.split('/').map(encodeURIComponent).join('/')+
    '?ref='+params.sourceSha,githubInstallationToken,fetchImpl);
   if(file.type!=='file'||file.path!==params.path||file.encoding!=='base64'||
      typeof file.content!=='string')fail('github-file-invalid');
   const text=Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8');
   if(Buffer.byteLength(text)>MAX_BYTES)fail('github-file-too-large');
   return Object.freeze({status:200,repository:REPO,path:params.path,
    sourceSha:params.sourceSha,text,installationId:identity.id,
    installationVerified:true,repositoryAccessVerified:true});
  }
 });
}

/** Explicit opt-in from an authorized cloud worker; do not bind credentials
 * from an untrusted HTTP request. Reuse one verified per-App token.
 */
export function makeNodeCouncilExternalTransport({githubInstallationToken}={}){
 return makeCouncilExternalTransport({
  dnsResolve:nodeDnsLookup,httpsRequest:nodeHttpsRequest,
  githubInstallationToken,fetchImpl:globalThis.fetch
 });
}
