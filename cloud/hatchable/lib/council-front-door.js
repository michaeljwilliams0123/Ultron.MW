import {createHash} from 'node:crypto';

// Council Room front door (Companion-first). Deterministic and advisory.
// Companion speaks first in plain language; consequential operations become
// in-thread approval cards that only REQUEST a decision. A card never executes
// anything, and no chat text can approve one: only the owner's explicit click
// on the card, recorded by /api/brain/council-room-approval, is a decision.
// Even a recorded approval is evidence of owner intent, not an executor; the
// operation still runs only through its existing governed path.

export const OWNER_DECISIONS=Object.freeze([
 {op:'pr.merge',title:'Merge a pull request',
  pattern:/\b(merge|merging|squash[- ]merge)\b/},
 {op:'release.publish',title:'Publish a release',
  pattern:/\b(release|publish|tag a version|cut a version)\b/},
 {op:'deploy.production',title:'Deploy to production',
  pattern:/\b(deploy|deployment|ship to prod|go live|roll ?out)\b/},
 {op:'spend.paid',title:'Spend money',
  pattern:/\b(buy|purchase|pay|paid plan|upgrade (the )?plan|subscribe|spend)\b/},
 {op:'permission.change',title:'Change permissions or access',
  pattern:/\b(permission|grant access|revoke access|collaborator|ruleset|branch protection)\b/},
 {op:'secret.write',title:'Create or change a secret',
  pattern:/\b(secret|credential|api key|token|private key|rotate)\b/},
 {op:'message.external',title:'Send something outside the room',
  pattern:/\b(email|send (a )?message|post (to|on)|tweet|slack|notify (the )?(team|users|customers)|comment on)\b/},
 {op:'repository.settings',title:'Change repository settings',
  pattern:/\b(repo(sitory)? settings|rename the repo|default branch|delete (the )?(repo|branch)|visibility)\b/}
]);
export const OWNER_DECISION_OPS=Object.freeze(OWNER_DECISIONS.map(x=>x.op));
const OWNER='michaeljwilliams0123';

function clean(value,max=500){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}

/** Operations in the owner's objective that only the owner may decide. */
export function detectOwnerDecisions(text){
 const lower=' '+clean(text,6000).toLowerCase()+' ';
 return OWNER_DECISIONS.filter(x=>x.pattern.test(lower)).map(x=>x.op);
}

export function approvalCardId(taskKey,op){
 if(typeof taskKey!=='string'||!/^room:[0-9]{1,18}$/.test(taskKey))throw Error('approval-card-task-invalid');
 if(!OWNER_DECISION_OPS.includes(op))throw Error('approval-card-op-invalid');
 return createHash('sha256').update('ultron.council-room.approval-card.v1\n'+taskKey+'\n'+op).digest('hex');
}

/** Cards that request (never grant) an owner decision. */
export function approvalCards({taskKey,ops}){
 const unique=[...new Set(Array.isArray(ops)?ops:[])].filter(op=>OWNER_DECISION_OPS.includes(op));
 return unique.map(op=>{
  const def=OWNER_DECISIONS.find(x=>x.op===op);
  return {schema:'ultron.council-room.approval-card.v1',id:approvalCardId(taskKey,op),op,
   title:def.title,state:'requested',to:OWNER,choices:['approve','decline'],
   reason:'Only the owner can decide this. The Council will not act on it from chat text.',
   executes:false,countsAsApproval:false,
   approvalRequires:'owner-click-on-this-card',
   afterApproval:'Recorded as owner intent; the operation still runs only through its existing governed path.'};
 });
}

/** Companion's first, plain-language reply in the thread. */
export function companionLead({prompt,members=[],observed=[],cards=[],issue=null}){
 const who=members.filter(m=>m.id!=='companion').map(m=>m.role);
 const seen=observed.filter(x=>x.status==='observed')
  .map(x=>x.repository.split('/')[1]+'@'+String(x.sha).slice(0,7));
 const lines=[];
 lines.push(issue?'I re-read issue #'+issue.number+' (“'+clean(issue.title,120)+'”) and asked the Council for a plan.':
  'Got it: “'+clean(prompt,160)+'”.');
 if(who.length)lines.push((who.length===1?who[0]+' is':who.slice(0,-1).join(', ')+' and '+who[who.length-1]+' are')+' weighing in below.');
 lines.push(seen.length?'Evidence I checked: '+seen.join(', ')+'.':'I could not read repository evidence this time, so treat the replies as unverified.');
 lines.push(cards.length?'You have '+cards.length+' decision card'+(cards.length>1?'s':'')+
  ' below. Nothing happens unless you click Approve on a card.':
  'Nothing here needs your approval. Everything below is advice only.');
 return {id:'companion',role:'Companion',kind:'result',lead:true,body:clean(lines.join(' '),1200)};
}

const HEX64=/^[a-f0-9]{64}$/;


/** Record the owner's click on a stored card. The card must exist in the
 * persisted Council result for that task; a client cannot invent a card, and
 * a decision is write-once. Returns a receipt that never executes anything. */
export async function recordApprovalDecision(db,{memberHandle,taskId,cardId,choice}={}){
 if(memberHandle!==OWNER)return {ok:false,status:403,error:'owner-required'};
 const id=Number(taskId);
 if(!Number.isSafeInteger(id)||id<1||!HEX64.test(cardId||'')||!['approve','decline'].includes(choice))
  return {ok:false,status:400,error:'approval-request-invalid'};
 const task=(await db.query(`SELECT id,task_key,objective,status,last_result FROM brain_tasks WHERE id=$1`,[id])).rows[0];
 if(!task||task.objective!=='council.room'||task.status!=='done')
  return {ok:false,status:404,error:'approval-card-not-found'};
 const cards=Array.isArray(task.last_result?.approvalCards)?task.last_result.approvalCards:[];
 const card=cards.find(c=>c&&c.id===cardId);
 // Re-derive the id so a tampered stored card cannot be accepted either.
 let expected=null;
 try{expected=card?approvalCardId(task.task_key,card.op):null}catch{expected=null}
 if(!card||expected!==cardId)return {ok:false,status:404,error:'approval-card-not-found'};
 const decision=choice==='approve'?'approved':'declined';
 const row=(await db.query(`WITH ins AS (
   INSERT INTO council_room_approvals(card_id,task_id,operation,decision,decided_by)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT(card_id) DO NOTHING
   RETURNING card_id,operation,decision,created_at,TRUE AS created)
  SELECT * FROM ins UNION ALL
  SELECT card_id,operation,decision,created_at,FALSE FROM council_room_approvals WHERE card_id=$1 LIMIT 1`,
  [cardId,id,card.op,decision,OWNER])).rows[0];
 if(!row)return {ok:false,status:503,error:'approval-not-persisted'};
 return {ok:true,status:row.created?201:(row.decision===decision?200:409),
  ...(row.created||row.decision===decision?{}:{error:'decision-already-recorded'}),
  decision:{cardId:row.card_id,taskId:id,op:row.operation,decision:row.decision,
   decidedBy:OWNER,via:'council-room-card-click',recordedAt:row.created_at,
   executes:false,next:row.decision==='approved'?
    'Owner intent recorded. The operation still runs only through its existing governed path.':
    'Declined. The Council will not pursue this operation.'}};
}
