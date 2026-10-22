import { db,browser } from 'hatchable';
import { runOne } from 'lib/brain-runner.js';
export const access='scheduler';
export const methods=['POST'];
export default async function(req,res){
 const hour=new Date().toISOString().slice(0,13).replace(/[^0-9]/g,'');
 await db.query("INSERT INTO brain_tasks(task_key,objective) VALUES($1,'repo.inspect') ON CONFLICT(task_key) DO NOTHING",['hourly-'+hour]);
 const result=await runOne({db,browser});
 return res.status(result.status==='failed'?503:200).json({...result,trigger:'hourly'});
}