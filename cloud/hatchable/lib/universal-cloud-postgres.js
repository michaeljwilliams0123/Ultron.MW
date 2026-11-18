/**
 * Universal cloud task ledger adapter. Reuses brain_tasks (status='external')
 * without adding tables or competing with the queued/leased scheduler.
 * Each new action receives a DB-allocated task ID as its immutable fence.
 * A duplicate idempotency key is NEVER dispatched twice.
 *
 * Construct only in the trusted Hatchable backend with PostgreSQL db and
 * current owner profile/stop versions. No credentials or provider POSTs here.
 */
const KEY=/^[a-z0-9][a-z0-9:_-]{7,127}$/;
const SHA=/^[a-f0-9]{64}$/;
const MAX=Number.MAX_SAFE_INTEGER;
function positiveInt(value){
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>0?value:null;
  if(typeof value==='string'&&/^[1-9][0-9]*$/.test(value)){
    const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;
  }
  return null;
}
function count(response){return Array.isArray(response?.rows)?response.rows.length:-1;}
export function createPostgresUniversalCloudOutbox({
  db,operation,profileVersion,stopVersion,
}={}){
  if(typeof db?.query!=='function'||typeof operation!=='string'||
    !operation.trim()||!positiveInt(profileVersion)||!positiveInt(stopVersion))
    throw Error('trusted-universal-cloud-ledger-unavailable');
  const taskKey=idempotencyKey=>'cloud:universal:'+idempotencyKey;
  return Object.freeze({
    async reserve({idempotencyKey,requestDigest,fencingEpoch}={}){
      if(!KEY.test(idempotencyKey||'')||!SHA.test(requestDigest||'')||
        fencingEpoch!==stopVersion)return {ok:false,reason:'invalid-intent-or-stop-fence'};
      const key=taskKey(idempotencyKey);
      // Atomic admission + unique-key insert. A failed/unknown INSERT is
      // never followed by a blind retry or a provider write.
      const inserted=await db.query(
        \`INSERT INTO brain_tasks(task_key,objective,status,attempts,max_attempts,
          fencing_generation,last_result)
        SELECT $1,'universal.cloud','external',0,1,1,
          jsonb_build_object('state','reserved','requestDigest',$2::text,
          'stopVersion',$3::bigint,'operation',$4::text)
        FROM brain_owner_autonomy_profile p
        JOIN brain_runtime_control c ON c.id=1
        WHERE p.id=1 AND p.owner='michaeljwilliams0123'
          AND p.preset IN ('build','release') AND p.version=$5
          AND p.max_paid_cents=0 AND jsonb_exists(p.allowed_operations,$4::text)
          AND NOT c.paused AND c.version=$3
        ON CONFLICT(task_key) DO NOTHING RETURNING id,last_result\`,
        [key,requestDigest,stopVersion,operation,profileVersion]);
      if(count(inserted)!==1){
        const prior=await db.query(
          \`SELECT last_result FROM brain_tasks WHERE task_key=$1 AND
           objective='universal.cloud' AND status='external'\`,[key]);
        if(count(prior)===1){
          return {ok:false,existingStatus:prior.rows[0].last_result?.state,
            reason:'duplicate-idempotency-key'};
        }
        return {ok:false,reason:'policy-denied-or-unknown-reservation'};
      }
      const allocated=positiveInt(inserted.rows[0].id);
      if(!allocated)return {ok:false,reason:'unsafe-db-fencing-generation'};
      return {ok:true,fencingEpoch:allocated};
    },
    async markSent({idempotencyKey,requestDigest,fencingEpoch}={}){
      if(!KEY.test(idempotencyKey||'')||!SHA.test(requestDigest||'')||
        !positiveInt(fencingEpoch))return {ok:false};
      const response=await db.query(
        \`UPDATE brain_tasks SET last_result=jsonb_set(last_result,'{state}',
          '"sent"'::jsonb),updated_at=now()
        WHERE id=$1 AND task_key=$2 AND objective='universal.cloud'
          AND status='external' AND last_result->>'state'='reserved'
          AND last_result->>'requestDigest'=$3
        RETURNING id\`,[fencingEpoch,taskKey(idempotencyKey),requestDigest]);
      return {ok:count(response)===1};
    },
    async markReconcile({idempotencyKey,fencingEpoch,reason}={}){
      if(!KEY.test(idempotencyKey||'')||!positiveInt(fencingEpoch)||
        typeof reason!=='string'||reason.length>160)return {ok:false};
      const response=await db.query(
        \`UPDATE brain_tasks SET last_result=last_result||
          jsonb_build_object('state','reconcile_required','reason',$3::text),
          updated_at=now()
        WHERE id=$1 AND task_key=$2 AND objective='universal.cloud'
          AND status='external' AND last_result->>'state'='sent'
        RETURNING id\`,[fencingEpoch,taskKey(idempotencyKey),reason]);
      return {ok:count(response)===1};
    },
    async markCompleted(receipt={}){
      const {idempotencyKey,requestDigest,fencingEpoch}=receipt;
      if(!KEY.test(idempotencyKey||'')||!SHA.test(requestDigest||'')||
        !positiveInt(fencingEpoch))return {verified:false};
      // Conditional terminal update; a stale generation or divergent digest
      // cannot overwrite another action's receipt.
      await db.query(
        \`UPDATE brain_tasks SET last_result=jsonb_build_object(
          'state','completed','requestDigest',$3::text,'receipt',$4::jsonb),
          updated_at=now()
        WHERE id=$1 AND task_key=$2 AND objective='universal.cloud'
          AND status='external' AND last_result->>'state'='sent'
          AND last_result->>'requestDigest'=$3\`,
        [fencingEpoch,taskKey(idempotencyKey),requestDigest,JSON.stringify(receipt)]);
      // Independently reread the committed PostgreSQL postcondition.
      const rows=await db.query(
        \`SELECT id,last_result FROM brain_tasks
         WHERE id=$1 AND task_key=$2 AND objective='universal.cloud'
           AND status='external'\`,[fencingEpoch,taskKey(idempotencyKey)]);
      const row=rows?.rows?.[0];
      const persisted=row?.last_result;
      const verified=count(rows)===1 && positiveInt(row.id)===fencingEpoch &&
        persisted?.state==='completed' &&
        persisted?.requestDigest===requestDigest &&
        persisted?.receipt?.requestDigest===requestDigest &&
        positiveInt(persisted?.receipt?.fencingEpoch)===fencingEpoch;
      return {verified,requestDigest:verified?requestDigest:null,
        fencingEpoch:verified?fencingEpoch:null};
    },
  });
}
