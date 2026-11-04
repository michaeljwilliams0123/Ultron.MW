import { db,scheduler,events } from 'hatchable';
import {
 queueObjective,saveNote,controlTask,snapshot,admitAcceptanceEvidence
} from 'lib/brain-owner.js';
export const access='admin';
export const methods=['GET','POST'];
export default async function(req,res){
 if(req.method==='GET')return res.json(await snapshot({db}));
 const b=req.body||{};
 let result;
 if(b.action==='queue')result=await queueObjective({db,scheduler,events},b.objective,b.key);
 else if(b.action==='acceptance')result=await admitAcceptanceEvidence({db},
  b.objectiveId,b.pullNumber);
 else if(b.action==='note')result=await saveNote({db,events},b.kind,b.body);
 else if(b.action==='cancel'||b.action==='retry')result=await controlTask({db,events},b.action,b.id);
 else return res.status(400).json({error:'unsupported-command'});
 return res.status(result.ok?(b.action==='queue'&&result.created?202:200):result.error==='task-not-eligible'||result.error==='idempotency-key-conflict'||result.error==='acceptance-ledger-conflict'||result.error==='heldout-ledger-conflict'?409:400).json(result);
}
