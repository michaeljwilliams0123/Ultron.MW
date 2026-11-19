// Read-only, owner-scoped receipt reconciliation for the Council Action Desk.
// Never grants execution authority: the existing protected write routes own admission.
const TASK_KEY=/^[a-z0-9-]{6,80}$/;
const ACTION_KEY=/^[a-z][a-z0-9_.:-]{7,119}$/;
const SHA=/^[0-9a-f]{40}$/;
const REPO='michaeljwilliams0123/Ultron.MW';
const number=value=>{if(value===null||value===undefined||value==='')return null;\n const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;};

export function validDeskKeys({taskKey=null,actionKey=null}={}){
 return (taskKey===null||(typeof taskKey==='string'&&TASK_KEY.test(taskKey)))&&
  (actionKey===null||(typeof actionKey==='string'&&ACTION_KEY.test(actionKey)));
}

export function shapeTask(row){
 if(!row)return {status:'not-found',verification:'not-observed'};
 const receiptId=number(row.receipt_id);
 const status=String(row.status||'unknown');
 const result=row.last_result||{};
 const observed=status==='done'&&receiptId!==null&&
  row.objective==='repo.inspect'&&result.objective==='repo.inspect'&&
  result.repository===REPO&&result.source==='github-api'&&
  typeof result.sha==='string'&&SHA.test(result.sha);
 return {id:number(row.id),taskKey:String(row.task_key||''),
  objective:String(row.objective||''),status,
  receiptId,verification:observed?'task-result-persisted':
   status==='done'?'reconcile-required':receiptId?'awaiting-terminal-result':'receipt-unavailable',
  sourceSha:observed?result.sha:null,
  updatedAt:row.updated_at||null};
}

export function shapeNote(rows){
 if(!rows.length)return {status:'not-found',verification:'not-observed'};
 if(rows.length!==1)return {status:'reconcile-required',verification:'ambiguous-note-key'};
 const row=rows[0];
 const receiptId=number(row.receipt_id),receiptCount=number(row.receipt_count);
 const valid=number(row.id)!==null&&receiptId!==null&&receiptCount===1&&
  row.kind==='observation'&&/^[a-f0-9]{64}$/.test(String(row.fingerprint||''));
 return {status:valid?'completed':'reconcile-required',
  verification:valid?'note-and-receipt-persisted':'receipt-unverified',
  noteId:number(row.id),receiptId:valid?receiptId:null};
}

export async function collectActionDeskState({db,taskKey=null,actionKey=null}={}){
 if(!validDeskKeys({taskKey,actionKey}))throw Error('action-desk-key-invalid');
 if(typeof db?.query!=='function')throw Error('action-desk-database-unavailable');
 const [profileResult,controlResult]=await Promise.all([
  db.query('SELECT owner,preset,version,max_paid_cents,allowed_operations FROM brain_owner_autonomy_profile WHERE id=1'),
  db.query('SELECT paused,version FROM brain_runtime_control WHERE id=1')
 ]);
 const profile=profileResult?.rows?.[0],control=controlResult?.rows?.[0];
 if(!profile||!control)throw Error('action-desk-authority-unavailable');
 const allowed=Array.isArray(profile.allowed_operations)?profile.allowed_operations:[];
 const paused=control.paused===true,zeroPaid=Number(profile.max_paid_cents)===0;
 const owner=profile.owner==='michaeljwilliams0123';
 const inspectionAllowed=owner&&!paused&&zeroPaid&&allowed.includes('repo.inspect');
 const noteAllowed=owner&&!paused&&zeroPaid&&
  ['build','release'].includes(profile.preset)&&allowed.includes('cloud.note.create');
 const output={schema:'ultron.action-desk.v1',ok:true,observedAt:new Date().toISOString(),
  authority:{preset:String(profile.preset||'unknown'),profileVersion:number(profile.version),
   stopVersion:number(control.version),paused,paidCeilingCents:Number(profile.max_paid_cents),
   inspectionAllowed,noteAllowed,releaseAuthorized:false},
  task:null,note:null};
 if(taskKey!==null){
  const sql=[
   'SELECT t.id,t.task_key,t.objective,t.status,t.last_result,t.updated_at,',
   '(SELECT MIN(e.id) FROM brain_events e WHERE e.task_id=t.id',
   "AND e.event_type='owner-queued' AND e.details->>'objective'=t.objective) AS receipt_id",
   'FROM brain_tasks t WHERE t.task_key=$1 LIMIT 2'
  ].join(' ');
  const rows=(await db.query(sql,[taskKey])).rows||[];
  output.task=rows.length>1?{status:'reconcile-required',verification:'ambiguous-task-key'}:shapeTask(rows[0]);
 }
 if(actionKey!==null){
  const sql=[
   'SELECT n.id,n.kind,n.fingerprint,',
   '(SELECT COUNT(*)::int FROM brain_events e WHERE',
   "e.event_type='cloud-action-observed' AND",
   "e.details->>'action_key'=n.action_key AND",
   "e.details->>'note_id'=n.id::text) AS receipt_count,",
   '(SELECT MIN(e.id) FROM brain_events e WHERE',
   "e.event_type='cloud-action-observed' AND",
   "e.details->>'action_key'=n.action_key AND",
   "e.details->>'note_id'=n.id::text) AS receipt_id",
   'FROM brain_notes n WHERE n.action_key=$1 LIMIT 2'
  ].join(' ');
  output.note=shapeNote((await db.query(sql,[actionKey])).rows||[]);
 }
 return output;
}
