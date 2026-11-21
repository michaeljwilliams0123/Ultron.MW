// Owner-only, read-only PR preflight for the conversational workspace.
// This route does not mint tokens, authorize merges or contact a write endpoint.
export const access='admin';
export const methods=['GET'];
const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const reply=(res,http,body)=>{res.setHeader('cache-control','private, no-store');return res.status(http).json({schema:'ultron.chat.pr-preflight.v1',...body});};
export default async function(req,res){
 if(req.member?.handle!=='michaeljwilliams0123')
  return reply(res,403,{ok:false,error:'owner-required'});
 const raw=String(req.query?.pr??'');
 if(!/^[1-9]\d{0,6}$/.test(raw))
  return reply(res,400,{ok:false,error:'pr-number-invalid'});
 const number=Number(raw);
 try{
  const r=await fetch('https://api.github.com/repos/'+REPO+'/pulls/'+number,{
   method:'GET',headers:{'Accept':'application/vnd.github+json','User-Agent':'Ultron-MW-chat-preflight','X-GitHub-Api-Version':'2022-11-28'}
  });
  if(r.status===404)return reply(res,404,{ok:false,error:'pr-not-found'});
  if(!r.ok)return reply(res,503,{ok:false,error:'github-read-unavailable'});
  const p=await r.json();
  if(Number(p?.base?.repo?.id)!==REPO_ID||Number(p?.number)!==number||
    String(p?.base?.repo?.full_name)!==REPO)
   return reply(res,409,{ok:false,error:'repository-binding-mismatch'});
  const merged=p.merged_at!==null&&typeof p.merged_at==='string';
  return reply(res,200,{ok:true,mode:'inspection-only',number,
   title:String(p.title||'').slice(0,180),state:p.state==='open'?'open':'closed',
   draft:p.draft===true,merged,mergeable:p.mergeable===true?true:p.mergeable===false?false:null,
   headSha:/^[a-f0-9]{40}$/.test(p.head?.sha||'')?p.head.sha:null,
   baseSha:/^[a-f0-9]{40}$/.test(p.base?.sha||'')?p.base.sha:null,
   url:'https://github.com/'+REPO+'/pull/'+number,
   checksVerified:false,executionAuthorized:false,
   next:'A separate operation-specific owner-signed executor must validate CI and merge permissions before any write.'});
 }catch{return reply(res,503,{ok:false,error:'github-read-unavailable'});}
}
