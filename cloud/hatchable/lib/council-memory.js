import {createHash,createHmac,timingSafeEqual} from 'node:crypto';

// Council of Ultron Phase 2 memory store on Hatchable PostgreSQL.
// Pure library: every function takes the db client, so the same SQL runs on
// Hatchable, on PGlite in tests and from src/council-memory-store.mjs.
// Default OFF and fail closed (see memoryMode). Advisory memory only: nothing
// here grants authority, executes an operation or counts as an approval.
// The snapshot format is the in-repo `ultron.council-memory.v1` produced by
// createCouncilMemory().snapshot() in src/council-of-ultron.mjs, byte for byte.

export const SCHEMA='ultron.council-memory.v1';
export const MAX_BATCH=500;
export const MEMBERS=Object.freeze({
 'ultron-core':'council/core','ultron-builder':'council/builder','ultron-skeptic':'council/skeptic',
 'ultron-steward':'council/steward','ultron-predictor':'council/predictor','ultron-generator':'council/generator',
 'ultron-sentinel':'council/sentinel','ultron-companion':'council/companion'
});
const MEMBER_IDS=Object.keys(MEMBERS);
export const LANES=Object.freeze(['agentic','generative','predictive','self-improvement','reasoning',
 'reliability','governance','continuity']);
// Must match SCORECARD_COLUMNS in src/council-of-ultron.mjs (tested).
export const SCORECARD_COLUMN_NAMES=Object.freeze(['member_id','lane','attempts','successes','rate','snapshot_sha256']);
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
const HEX64=/^[a-f0-9]{64}$/;
const FACT_KEY=/^[a-z][a-z0-9_.-]{1,63}$/;
const EVIDENCE=/^(?:https:\/\/github\.com\/michaeljwilliams0123\/(?:Ultron\.MW|mahoraga)\/\S{1,300}|sha256:[a-f0-9]{64}|receipt:[A-Za-z0-9_.:-]{8,160})$/;
const SECRET_LIKE=/(?:sk-[a-zA-Z0-9]{16,}|gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{15,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const OUTCOMES=['succeeded','failed','held'];

const fail=code=>{throw Object.assign(new Error('council-memory-'+code),{code})};

/** Only the exact value "postgres" turns the store on. Anything else is off. */
export function memoryMode(value){return value==='postgres'?'postgres':'off'}

export function canonicalJson(value){
 if(value===null)return 'null';
 if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}';
 fail('unsupported-value');
}
export const sha256Of=value=>createHash('sha256').update(canonicalJson(value).replace(/\r\n?/g,'\n'),'utf8').digest('hex');

function text(value,max,code){
 if(typeof value!=='string'||!value.trim()||value.length>max)fail(code);
 if(SECRET_LIKE.test(value))fail('credential-like-material');
 return value;
}
function evidence(list,{required}){
 if(!Array.isArray(list)||list.length>10||(required&&!list.length)||
    list.some(x=>typeof x!=='string'||!EVIDENCE.test(x))||new Set(list).size!==list.length)fail('evidence-invalid');
 return list;
}
function iso(at){if(typeof at!=='string'||!ISO.test(at))fail('at-invalid');return at}

/** Validate one entry and enforce one writer per key-space. */
export function validateEntry(entry){
 const {memberId,writtenBy,kind,factKey=null,body}=entry||{};
 if(!MEMBER_IDS.includes(memberId))fail('member-unknown');
 if(!body||typeof body!=='object'||Array.isArray(body))fail('body-invalid');
 if(kind==='outcome'){if(writtenBy!=='ultron-core')fail('writer-not-owner')}
 else if(writtenBy!==memberId)fail('writer-not-owner');
 if(kind==='fact'){
  if(!FACT_KEY.test(factKey||''))fail('fact-key-invalid');
  text(body.value,500,'fact-invalid');iso(body.at);
  if(Object.keys(body).sort().join()!=='at,value')fail('body-invalid');
 }else if(factKey!==null)fail('fact-key-invalid');
 if(kind==='journal'){
  iso(body.at);
  if(!/^[a-z][a-z-]{1,31}$/.test(body.kind||''))fail('journal-kind-invalid');
  text(body.text,1000,'journal-text-invalid');
  if(body.lane!==null&&!LANES.includes(body.lane))fail('journal-lane-invalid');
  if(body.outcome!==null&&!OUTCOMES.includes(body.outcome))fail('journal-outcome-invalid');
  evidence(body.evidence,{required:false});
  if(Object.keys(body).sort().join()!=='at,evidence,kind,lane,outcome,text')fail('body-invalid');
 }
 if(kind==='shared'){
  iso(body.at);if(body.by!==memberId)fail('writer-not-owner');
  text(body.fact,500,'shared-fact-invalid');evidence(body.evidence,{required:true});
  if(Object.keys(body).sort().join()!=='at,by,evidence,fact')fail('body-invalid');
 }
 if(kind==='outcome'){
  iso(body.at);
  if(!HEX64.test(body.routing||'')||body.lead!==memberId||!OUTCOMES.includes(body.status)||
     !Array.isArray(body.lanes)||!body.lanes.length||body.lanes.length>8||body.lanes.some(l=>!LANES.includes(l))||
     typeof body.taskId!=='string'||!/^[a-z0-9][a-z0-9:._-]{2,80}$/.test(body.taskId)||
     typeof body.evidenceVerified!=='boolean')fail('outcome-invalid');
  evidence(body.evidence,{required:true});
  if(Object.keys(body).sort().join()!=='at,evidence,evidenceVerified,lanes,lead,routing,status,taskId')fail('body-invalid');
 }
 if(!['fact','journal','shared','outcome'].includes(kind))fail('kind-invalid');
 if(canonicalJson(body).length>8000)fail('body-too-large');
 return {memberId,writtenBy,kind,factKey,atIso:body.at,body,
  entryKey:sha256Of({memberId,kind,factKey,body})};
}

/** Append a batch atomically (one statement). Replays are no-ops. */
export async function appendEntries(db,entries){
 if(!Array.isArray(entries)||!entries.length||entries.length>MAX_BATCH)fail('batch-invalid');
 const rows=entries.map(validateEntry).map(e=>({entry_key:e.entryKey,member_id:e.memberId,written_by:e.writtenBy,
  kind:e.kind,fact_key:e.factKey,at_iso:e.atIso,body:e.body}));
 const out=await db.query(`INSERT INTO brain_council_memory_entries(entry_key,member_id,written_by,kind,fact_key,at_iso,body)
  SELECT r.entry_key,r.member_id,r.written_by,r.kind,r.fact_key,r.at_iso,r.body
  FROM jsonb_to_recordset($1::jsonb) AS r(entry_key text,member_id text,written_by text,kind text,fact_key text,at_iso text,body jsonb)
  ON CONFLICT(entry_key) DO NOTHING RETURNING id`,[JSON.stringify(rows)]);
 return {submitted:rows.length,inserted:out.rows.length};
}

/** Refuse any snapshot whose schema or content hash does not match. */
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const plain=o=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
export function verifySnapshot(snapshot){
 if(!plain(snapshot)||snapshot.schema!==SCHEMA)fail('snapshot-schema-mismatch');
 if(Object.keys(snapshot).sort().join()!=='members,outcomes,schema,sha256,shared')fail('snapshot-shape-invalid');
 const {sha256,...body}=snapshot;
 if(!HEX64.test(sha256||'')||sha256Of(body)!==sha256)fail('snapshot-digest-mismatch');
 if(!plain(body.members)||!Array.isArray(body.shared)||!Array.isArray(body.outcomes))fail('snapshot-shape-invalid');
 for(const id of Object.keys(body.members)){
  const slot=body.members[id];
  if(!MEMBER_IDS.includes(id)||!plain(slot)||Object.keys(slot).sort().join()!=='journal,namespace,profile'||
     slot.namespace!==MEMBERS[id]||!plain(slot.profile)||!Array.isArray(slot.journal))fail('snapshot-member-invalid');
  for(const k of Object.keys(slot.profile))if(!FACT_KEY.test(k))fail('fact-key-invalid');
 }
 return body;
}

// Keyed seal. The plain sha256 is tamper-evident only; anyone can recompute
// it. The HMAC binds a snapshot to the owner's ULTRON_COUNCIL_MEMORY_HMAC_KEY.
// No key, no seal and no load: fail closed.
export function hmacKey(raw){
 if(typeof raw!=='string'||!raw.trim())fail('hmac-key-missing');
 let key;try{key=Buffer.from(raw.trim(),'base64')}catch{fail('hmac-key-invalid')}
 if(key.length<32)fail('hmac-key-invalid');
 return key;
}
export const SEALED_SCHEMA='ultron.council-memory.sealed.v1';
export function sealSnapshot(snapshot,key){
 verifySnapshot(snapshot);
 const mac=createHmac('sha256',key).update(SEALED_SCHEMA+'\n'+snapshot.sha256).digest('hex');
 return {schema:SEALED_SCHEMA,snapshot,hmacSha256:mac};
}
export function openSealed(sealed,key){
 if(!plain(sealed)||sealed.schema!==SEALED_SCHEMA||!HEX64.test(sealed.hmacSha256||''))fail('seal-invalid');
 verifySnapshot(sealed.snapshot);
 const want=createHmac('sha256',key).update(SEALED_SCHEMA+'\n'+sealed.snapshot.sha256).digest();
 if(!timingSafeEqual(want,Buffer.from(sealed.hmacSha256,'hex')))fail('seal-mismatch');
 // Re-run every write-path validator before anyone uses the content.
 entriesFromSnapshot(sealed.snapshot).forEach(validateEntry);
 return sealed.snapshot;
}

/** Turn a verified in-repo snapshot into owner-attributed entries. */
export function entriesFromSnapshot(snapshot){
 const body=verifySnapshot(snapshot);
 const out=[];
 for(const [memberId,slot] of Object.entries(body.members||{})){
  for(const [factKey,fact] of Object.entries(slot.profile))
   out.push({memberId,writtenBy:memberId,kind:'fact',factKey,body:fact});
  for(const j of slot.journal)out.push({memberId,writtenBy:memberId,kind:'journal',body:j});
 }
 for(const s of body.shared)out.push({memberId:s.by,writtenBy:s.by,kind:'shared',body:s});
 for(const o of body.outcomes)out.push({memberId:o.lead,writtenBy:'ultron-core',kind:'outcome',body:o});
 // Restore order by timestamp keeps "newest fact wins" faithful.
 return out.sort((a,b)=>a.body.at<b.body.at?-1:a.body.at>b.body.at?1:0);
}

/** Import a snapshot: verify first, then insert everything in one statement per batch. */
export async function importSnapshot(db,sealed,key){
 const snapshot=openSealed(sealed,key); // HMAC + full validation before the first write
 const entries=entriesFromSnapshot(snapshot);
 let inserted=0;
 for(let i=0;i<entries.length;i+=MAX_BATCH)inserted+=(await appendEntries(db,entries.slice(i,i+MAX_BATCH))).inserted;
 return {entries:entries.length,inserted};
}

/** Build the in-repo snapshot format from the table (same retention as src). */
export async function exportSnapshot(db,{journalLimit=200}={}){
 if(!Number.isSafeInteger(journalLimit)||journalLimit<1||journalLimit>5000)fail('journal-limit-invalid');
 const rows=(await db.query(`SELECT id,member_id,written_by,kind,fact_key,body FROM brain_council_memory_entries ORDER BY id`)).rows;
 // Build in Maps (no prototype keys), re-validating every row as it loads.
 const facts=new Map(MEMBER_IDS.map(id=>[id,new Map()])),journals=new Map(MEMBER_IDS.map(id=>[id,[]]));
 const shared=[],outcomes=[];
 let lastEntryId=0;
 for(const r of rows){
  lastEntryId=Math.max(lastEntryId,Number(r.id));
  const body=typeof r.body==='string'?JSON.parse(r.body):r.body;
  const e=validateEntry({memberId:r.member_id,writtenBy:r.written_by,kind:r.kind,factKey:r.fact_key??null,body});
  if(e.kind==='fact')facts.get(e.memberId).set(e.factKey,body);
  else if(e.kind==='journal')journals.get(e.memberId).push(body);
  else if(e.kind==='shared')shared.push(body);
  else outcomes.push(body);
 }
 const data={schema:SCHEMA,members:{},shared,outcomes};
 for(const id of MEMBER_IDS){
  const profile={};for(const k of [...facts.get(id).keys()].sort())profile[k]=facts.get(id).get(k);
  data.members[id]={namespace:MEMBERS[id],profile,journal:journals.get(id)};
 }
 for(const id of MEMBER_IDS){const j=data.members[id].journal;if(j.length>journalLimit)j.splice(0,j.length-journalLimit)}
 if(data.shared.length>journalLimit)data.shared.splice(0,data.shared.length-journalLimit);
 if(data.outcomes.length>journalLimit*5)data.outcomes.splice(0,data.outcomes.length-journalLimit*5);
 return {snapshot:{...data,sha256:sha256Of(data)},lastEntryId};
}

/** Store a snapshot only after re-verifying it (never write then check). */
export async function storeVerifiedSnapshot(db,{snapshot,lastEntryId},key){
 const sealed=sealSnapshot(snapshot,key);
 openSealed(sealed,key); // verify before storing, never after
 if(!Number.isSafeInteger(lastEntryId)||lastEntryId<0)fail('last-entry-invalid');
 const r=await db.query(`INSERT INTO brain_council_memory_snapshots(sha256,schema_version,last_entry_id,hmac_sha256,body)
  VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(sha256) DO NOTHING RETURNING id`,
  [snapshot.sha256,SCHEMA,lastEntryId,sealed.hmacSha256,JSON.stringify(snapshot)]);
 return {sha256:snapshot.sha256,hmacSha256:sealed.hmacSha256,stored:r.rows.length===1};
}

/** Read a stored snapshot and refuse it unless schema and hash still match. */
export async function readStoredSnapshot(db,sha256,key){
 if(!HEX64.test(sha256||''))fail('snapshot-id-invalid');
 const row=(await db.query(`SELECT body,hmac_sha256 FROM brain_council_memory_snapshots WHERE sha256=$1`,[sha256])).rows[0];
 if(!row)return null;
 const snapshot=typeof row.body==='string'?JSON.parse(row.body):row.body;
 return openSealed({schema:SEALED_SCHEMA,snapshot,hmacSha256:row.hmac_sha256},key);
}

/** The ONE "is this outcome verified" predicate. Only a literal boolean
 * true in evidenceVerified counts: 'true', 1, missing or anything else is
 * unverified. Shared with src/council-of-ultron.mjs (routing-side guard and
 * restore) so the scorecard and routing rules cannot drift. */
export const isVerifiedOutcome=outcome=>
 outcome!==null&&typeof outcome==='object'&&outcome.evidenceVerified===true;

/** Scorecard over VERIFIED outcomes only (isVerifiedOutcome). Unverified
 * outcomes are references, not results, and never move routing. */
export function verifiedScorecard(snapshot){
 const card={};
 for(const o of verifySnapshot(snapshot).outcomes){
  if(!isVerifiedOutcome(o)||o.status==='held')continue;
  for(const lane of o.lanes){
   const slot=((card[o.lead]||={})[lane]||={attempts:0,successes:0,rate:0.5});
   slot.attempts+=1;if(o.status==='succeeded')slot.successes+=1;
   slot.rate=Number(((slot.successes+1)/(slot.attempts+2)).toFixed(4));
  }
 }
 return card;
}

/** Write one whole scorecard generation in a single statement. The prior
 * generation stays current until this one exists (no in-place update). */
export async function writeScorecardGeneration(db,rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>MEMBER_IDS.length*LANES.length)fail('scorecard-invalid');
 const sha=rows[0].snapshot_sha256;
 for(const r of rows){
  if(Object.keys(r).sort().join()!==[...SCORECARD_COLUMN_NAMES].sort().join())fail('scorecard-columns-mismatch');
  if(r.snapshot_sha256!==sha||!MEMBER_IDS.includes(r.member_id)||!LANES.includes(r.lane)||
     !Number.isSafeInteger(r.attempts)||!Number.isSafeInteger(r.successes)||r.successes<0||r.successes>r.attempts||
     Number(((r.successes+1)/(r.attempts+2)).toFixed(4))!==r.rate)fail('scorecard-row-invalid');
 }
 const out=await db.query(`INSERT INTO brain_council_scorecard_rows(member_id,lane,attempts,successes,rate,snapshot_sha256)
  SELECT r.member_id,r.lane,r.attempts,r.successes,r.rate,r.snapshot_sha256
  FROM jsonb_to_recordset($1::jsonb) AS r(member_id text,lane text,attempts int,successes int,rate numeric,snapshot_sha256 text)
  ON CONFLICT(snapshot_sha256,member_id,lane) DO NOTHING RETURNING id`,[JSON.stringify(rows)]);
 return {snapshotSha256:sha,inserted:out.rows.length};
}

/** Current scorecard = the newest complete generation. */
export async function readCurrentScorecard(db){
 const rows=(await db.query(`WITH latest AS (
   SELECT snapshot_sha256 FROM brain_council_scorecard_rows ORDER BY id DESC LIMIT 1)
  SELECT member_id,lane,attempts,successes,rate::float8 AS rate,s.snapshot_sha256
  FROM brain_council_scorecard_rows s JOIN latest USING(snapshot_sha256) ORDER BY member_id,lane`)).rows;
 return rows.map(r=>({...r,rate:Number(r.rate)}));
}
