/**
 * Owner-only read of persisted C04 executions. No reservation or provider write.
 * Reuses migration 0041 rather than creating a parallel attempt table.
 */
import {db} from 'hatchable';
export const access='admin';
export const methods=['GET'];
const OWNER='michaeljwilliams0123';
const REPO='michaeljwilliams0123/Ultron.MW';
function reply(res,status,body){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Vary','Cookie');
 return res.status(status).json({schema:'ultron.github.pr-comment-status.v1',...body});
}
export default async function handler(req,res){
 if(req.member?.handle!==OWNER)return reply(res,403,{error:'owner-identity-required'});
 const raw=req.query?.pr;
 if(typeof raw!=='string'||!/^[1-9][0-9]{0,8}$/.test(raw))
  return reply(res,400,{error:'invalid-pr-number'});
 const pr=Number(raw);
 try{
  const result=await db.query(`SELECT idempotency_key,state,target_number,body_sha256,
   receipt,created_at FROM github_pr_comment_executions
   WHERE repository=$1 AND target_number=$2
     AND state IN ('reserved','in_flight','reconcile_required','completed')
   ORDER BY CASE WHEN state IN ('in_flight','reconcile_required') THEN 0
     WHEN state='reserved' THEN 1 ELSE 2 END, created_at DESC LIMIT 1`,[REPO,pr]);
  const row=result?.rows?.[0];
  if(!row)return reply(res,200,{state:'idle',pullRequest:pr});
  return reply(res,200,{state:row.state,attemptId:row.idempotency_key,
   pullRequest:pr,bodySha256:row.body_sha256,
   ...(row.state==='completed'&&row.receipt?{receipt:row.receipt}:{})});
 }catch{return reply(res,503,{state:'unavailable',error:'status-read-unavailable'});}
}
