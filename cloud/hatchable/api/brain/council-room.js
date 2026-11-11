import {db,scheduler,events} from 'hatchable';
import {COUNCIL_ROOM_ROLES} from 'lib/council-room-core.js';

export const access='admin';
export const methods=['GET','POST'];

const ROLE_IDS=new Set(COUNCIL_ROOM_ROLES.map(x=>x.id));
const KEY=/^room:[A-Za-z0-9._:-]{8,160}$/;
const SECRET_LIKE=/(?:password|passcode|otp|api[_ -]?key|private[_ -]?key)\s*[:=]|\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i;

function reply(res,status,value){
 res.setHeader('cache-control','private, no-store');
 return res.status(status).json({schema:'ultron.council-room.v1',...value});
}
function normalizeMentions(value){
 if(!Array.isArray(value))return [];
 return [...new Set(value.map(x=>String(x||'').toLowerCase()).filter(x=>ROLE_IDS.has(x)))];
}
function publicTask(row){
 const jobState=row.task_status==='done'?'done':row.task_status==='blocked'?'blocked':
  row.task_status==='leased'?'running':'queued';
 return {
  id:row.job_id,messageId:row.id,state:jobState,taskId:row.task_id,
  taskKey:row.task_key,updatedAt:row.task_updated_at,
  externalUrl:row.external_url||null,externalId:row.external_id||null,
  externalKind:row.external_kind||null,
  executionState:row.execution_state||'not_requested',
  executionResult:row.execution_result||{},
  result:row.last_result||null
 };
}
function cardsWithDecisions(cards,decisions){
 if(!Array.isArray(cards))return [];
 return cards.slice(0,8).map(c=>{
  const d=decisions?.[c.id];
  return {id:String(c.id||''),op:String(c.op||''),title:String(c.title||''),
   reason:String(c.reason||''),choices:['approve','decline'],executes:false,
   state:d?d.decision:decisions===null?'decision-recording-unavailable':'requested',
   decidedAt:d?.recordedAt||null};
 });
}
function flatten(rows,decisions={}){
 const messages=[];
 for(const row of rows){
  messages.push({
   id:String(row.id),messageKey:row.message_key,authorType:row.author_type,
   authorId:row.author_id,kind:row.kind,body:row.body,
   mentions:row.mentions||[],context:row.context||{},
   createdAt:row.created_at,job:row.job_id?publicTask(row):null
  });
  const result=row.last_result;
  if(row.task_status==='done'&&result?.companion?.lead===true){
   // Companion replies first, in plain language, with any approval cards.
   messages.push({
    id:'lead:'+row.task_id,messageKey:'lead:'+row.task_key,
    authorType:'member',authorId:'companion',authorRole:'Companion',
    kind:'result',body:String(result.companion.body||'').slice(0,1200),
    mentions:[],context:{taskId:row.task_id,lead:true,
     approvalCards:cardsWithDecisions(result.approvalCards,decisions)},
    createdAt:result.at||row.task_updated_at,job:null
   });
  }
  if(row.task_status==='done'&&Array.isArray(result?.members)){
   for(let i=0;i<result.members.length;i++){
    const m=result.members[i];
    messages.push({
     id:'result:'+row.task_id+':'+i,messageKey:'result:'+row.task_key+':'+m.id,
     authorType:'member',authorId:m.id,authorRole:m.role,
     kind:m.kind||'inference',body:String(m.body||'').slice(0,1200),
     mentions:[],context:{taskId:row.task_id,source:result.source,
      observedRepositories:result.observedRepositories||[],
     ...(m.action?{action:m.action,evidence:m.evidence,
      evidenceStatus:m.evidenceStatus,executionStatus:m.executionStatus,
      issueUrl:result.issuePlan?.issue?.url}: {})},
     createdAt:result.at||row.task_updated_at,job:null
    });
   }
   messages.push({
    id:'summary:'+row.task_id,messageKey:'summary:'+row.task_key,
    authorType:'system',authorId:'council',
    kind:'result',body:String(result.summary||'Council result recorded.').slice(0,1200),
    mentions:[],context:{taskId:row.task_id,paidCents:result.paidCents||0,
     githubAdapter:result.githubAdapter,cloudflareRole:result.cloudflareRole,
     executionState:row.execution_state||'not_requested',
     externalUrl:row.external_url||null,
     planStatus:result.planStatus||null,
     githubWriteStatus:result.githubWriteStatus||null,
     issueUrl:result.issuePlan?.issue?.url||null},
    createdAt:result.at||row.task_updated_at,job:null
   });
  }
 }
 return messages.sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||
  String(a.id).localeCompare(String(b.id)));
}

// Owner decisions on approval cards. Returns null (cards shown as
// "decision recording unavailable") until migration 0042 is applied, so the
// room keeps working on an older schema.
async function readDecisions(page){
 const ids=[...new Set(page.filter(r=>Array.isArray(r.last_result?.approvalCards)&&
  r.last_result.approvalCards.length).map(r=>Number(r.task_id)))];
 if(!ids.length)return {};
 try{
  const rows=(await db.query(`SELECT card_id,decision,created_at FROM council_room_approvals
    WHERE task_id=ANY($1::bigint[])`,[ids])).rows;
  const out={};
  for(const r of rows)out[r.card_id]={decision:r.decision,recordedAt:r.created_at};
  return out;
 }catch{return null}
}

async function snapshot(res,req){
 const limit=Math.min(Math.max(Number(req.query?.limit)||50,10),100);
 const cursor=Number(req.query?.before)||null;
 const rows=(await db.query(`SELECT m.id,m.message_key,m.author_type,m.author_id,m.kind,
   m.body,m.mentions,m.context,m.created_at,
   j.id AS job_id,j.external_url,t.id AS task_id,t.task_key,t.status AS task_status,
   j.external_id,j.external_kind,j.execution_state,j.execution_result,
   t.last_result,t.updated_at AS task_updated_at
   FROM council_room_messages m
   LEFT JOIN council_room_jobs j ON j.message_id=m.id
   LEFT JOIN brain_tasks t ON t.id=j.task_id
   WHERE m.room_key='owner-main' AND ($1::bigint IS NULL OR m.id<$1)
   ORDER BY m.id DESC LIMIT $2`,[cursor,limit+1])).rows;
 const page=rows.slice(0,limit);
 const nextCursor=rows.length>limit?page[page.length-1].id:null;
 const jobs=page.filter(x=>x.job_id).map(publicTask);
 const decisions=await readDecisions(page);
 const flat=flatten(page,decisions);
 const lastByRole={};
 for(const item of flat)if(item.authorType==='member'&&!lastByRole[item.authorId])
  lastByRole[item.authorId]=item.createdAt;
 return reply(res,200,{ok:true,room:{id:'owner-main',title:'Ultron Council Room'},
  members:COUNCIL_ROOM_ROLES.map(x=>({...x,status:lastByRole[x.id]?'active':'standby',
   lastActiveAt:lastByRole[x.id]||null})),
  messages:flat,jobs,nextCursor,frontDoor:'companion-first-v1',
  integrations:{hatchable:'system-of-record',github:'source-ci-and-execution-adapter',
   mahoraga:'evidence-source',cloudflare:'optional-browser-only'},paidSpendCeiling:0});
}

async function post(res,req){
 const body=String(req.body?.body||'').trim();
 const messageKey=String(req.body?.messageKey||'');
 const mentions=normalizeMentions(req.body?.mentions);
 const context={
  repositories:['michaeljwilliams0123/Ultron.MW','michaeljwilliams0123/mahoraga'],
  includeMahoraga:req.body?.includeMahoraga!==false,
  attachmentUrl:typeof req.body?.attachmentUrl==='string'?
   req.body.attachmentUrl.slice(0,1000):null
 };
 if(!KEY.test(messageKey))return reply(res,400,{ok:false,error:'message-key-invalid'});
 if(!body||body.length>6000)return reply(res,400,{ok:false,error:'message-invalid'});
 if(SECRET_LIKE.test(body))return reply(res,422,{ok:false,error:'secret-like-content-rejected'});
 if(context.attachmentUrl&&!/^https:\/\//i.test(context.attachmentUrl))
  return reply(res,400,{ok:false,error:'attachment-url-invalid'});
 const kind=['message','question','action'].includes(req.body?.kind)?req.body.kind:'message';
 const result=(await db.query(`WITH inserted AS (
   INSERT INTO council_room_messages(message_key,author_type,author_id,kind,body,mentions,context)
   VALUES($1,'owner','michaeljwilliams0123',$2,$3,$4::jsonb,$5::jsonb)
   ON CONFLICT(message_key) DO NOTHING RETURNING id
 ), chosen AS (
   SELECT id FROM inserted UNION ALL
   SELECT id FROM council_room_messages WHERE message_key=$1 LIMIT 1
 ), task_insert AS (
   INSERT INTO brain_tasks(task_key,objective)
   SELECT 'room:'||id::text,'council.room' FROM chosen
   ON CONFLICT(task_key) DO NOTHING RETURNING id,task_key
 ), task_chosen AS (
   SELECT id,task_key FROM task_insert UNION ALL
   SELECT t.id,t.task_key FROM brain_tasks t JOIN chosen c
    ON t.task_key='room:'||c.id::text LIMIT 1
 ), job_insert AS (
   INSERT INTO council_room_jobs(message_id,task_id)
   SELECT c.id,t.id FROM chosen c CROSS JOIN task_chosen t
   ON CONFLICT(message_id) DO NOTHING RETURNING id
 )
 SELECT c.id,t.id AS task_id,t.task_key,
   EXISTS(SELECT 1 FROM inserted) AS created
 FROM chosen c CROSS JOIN task_chosen t`,
 [messageKey,kind,body,JSON.stringify(mentions),JSON.stringify(context)])).rows[0];
 if(!result)return reply(res,503,{ok:false,error:'message-not-persisted'});
 let scheduled=false;
 if(result.created){
  try{await scheduler.now('/api/brain/run',{via:'council-room'});scheduled=true}catch{}
  try{await events.publish('ultron.owner','council-room',{messageId:result.id})}catch{}
 }
 return reply(res,result.created?201:200,{ok:true,created:result.created,
  messageId:result.id,taskId:result.task_id,taskKey:result.task_key,scheduled});
}

export default async function(req,res){
 if(req.member?.handle!=='michaeljwilliams0123')
  return reply(res,403,{ok:false,error:'owner-required'});
 if(req.method==='GET')return snapshot(res,req);
 if(req.method==='POST')return post(res,req);
 return reply(res,405,{ok:false,error:'method-not-allowed'});
}
