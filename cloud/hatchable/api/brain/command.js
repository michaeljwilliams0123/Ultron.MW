import { db,scheduler } from 'hatchable';
import { queueObjective,saveNote,snapshot } from 'lib/brain-owner.js';
export const access='admin';
export const methods=['POST'];
const ROUTES={
 '/repo inspect':'repo.inspect','/repo prs':'repo.prs','/repo ci':'repo.ci',
 '/site render':'site.render','/council review':'council.review'
};
export default async function(req,res){
 const m=req.body?.message;
 if(typeof m!=='string'||m.length>1200)return res.status(400).json({error:'invalid-message'});
 const command=m.trim().toLowerCase();
 if(command==='/help')return res.json({commands:['/help','/status',...Object.keys(ROUTES),'/remember <note>'],mode:'deterministic-no-llm'});
 if(command==='/status')return res.json(await snapshot({db}));
 if(ROUTES[command]){
  const r=await queueObjective({db,scheduler},ROUTES[command],req.body.key);
  return res.status(r.ok?202:400).json({command,r});
 }
 if(command.startsWith('/remember ')){
  const note=m.trim().slice('/remember '.length);
  const r=await saveNote({db},'observation',note);
  return res.status(r.ok?200:400).json(r);
 }
 return res.status(400).json({error:'unknown-command',hint:'Use /help; model-based chat not configured'});
}