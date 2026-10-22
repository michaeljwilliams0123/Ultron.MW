import { db,browser } from 'hatchable';
import { runOne } from 'lib/brain-runner.js';
export const access='scheduler';
export const methods=['POST'];
export default async function(req,res){
 const results=[];
 for(let i=0;i<4;i++){
  const result=await runOne({db,browser});
  results.push(result);
  if(result.status!=='done')break;
 }
 return res.json({trigger:'owner-requested',count:results.filter(r=>r.status==='done').length,results});
}