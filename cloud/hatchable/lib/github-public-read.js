/**
 * Zero-paid public GitHub read. A transient 403/429 can occur on shared
 * anonymous egress; one short retry is permitted but no cached/synthetic
 * provider result is returned, and exhausted quotas are never retried here.
 */
const REPO='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const HEADERS={Accept:'application/vnd.github+json','User-Agent':'UltronMW-Cloud-Brain'};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function readGithubPublic(path,{fetchImpl=fetch,wait=pause}={}){
 if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||path.includes('://')||
   typeof fetchImpl!=='function'||typeof wait!=='function')throw Error('github-path-invalid');
 for(let attempt=0;attempt<2;attempt++){
  const response=await fetchImpl(REPO+path,{headers:HEADERS,signal:AbortSignal.timeout(10000)});
  if(response.ok)return response.json();
  const status=Number(response.status)||0;
  const remaining=response.headers?.get?.('x-ratelimit-remaining');
  const retryAfter=response.headers?.get?.('retry-after');
  if((status===403||status===429)&&remaining==='0')throw Error('github-rate-limited');
  const retryDelay=retryAfter==null?0:Number(retryAfter);
  if((status===403||status===429)&&attempt===0&&
     Number.isFinite(retryDelay)&&retryDelay<=1){
   await wait(350);
   continue;
  }
  throw Error('github-status-'+status);
 }
 throw Error('github-read-uncertain');
}
