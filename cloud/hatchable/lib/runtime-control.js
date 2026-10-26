// Persisted owner stop authority for cooperating Ultron executors.
// Not equivalent to revoking already issued third-party credentials.
export async function readExecutionControl({db}={}){
 if(!db?.query)throw Error('stop-control-unavailable');
 const found=await db.query(
  "SELECT paused,version,updated_at FROM brain_runtime_control WHERE id=1");
 const row=found?.rows?.[0];
 if(found?.rows?.length!==1||typeof row.paused!=='boolean'||
  !Number.isSafeInteger(row.version)||row.version<1||
  typeof row.updated_at!=='string')throw Error('stop-control-unavailable');
 return {paused:row.paused,version:row.version,updatedAt:row.updated_at};
}
export async function setExecutionControl({db,action,expectedVersion,reason}={}){
 if(!db?.query||!['pause','resume'].includes(action)||
    !Number.isSafeInteger(expectedVersion)||expectedVersion<1||
    typeof reason!=='string'||!reason.trim()||reason.trim().length>200)
  throw Error('invalid-stop-request');
 const paused=action==='pause';
 const event=paused?'owner-execution-paused':'owner-execution-resumed';
 const sql=`WITH moved AS (
  UPDATE brain_runtime_control
   SET paused=$1,reason=$2,version=version+1,updated_at=now()
   WHERE id=1 AND version=$3
   RETURNING paused,version
 ), receipt AS (
  INSERT INTO brain_events(event_type,details)
  SELECT $4::text,jsonb_build_object('paused',paused,'version',version)
  FROM moved RETURNING id
 )
 SELECT moved.paused,moved.version,receipt.id AS receipt_id
 FROM moved JOIN receipt ON true`;
 const result=await db.query(sql,[paused,reason.trim(),expectedVersion,event]);
 const row=result?.rows?.[0];
 return row?{ok:true,paused:row.paused,version:row.version,receiptId:row.receipt_id}:
  {ok:false,error:'version-conflict'};
}
