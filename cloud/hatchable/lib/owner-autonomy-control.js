/* C18 owner-scoped autonomy preferences, NOT permission grants or runtime execution. */
const OWNER='michaeljwilliams0123';
const OBSERVE=['research.public','repo.inspect','plan.create','test.local','evidence.read'];
const BUILD=[...OBSERVE,'branch.create','branch.update','pr.open','pr.comment',
 'verify.dispatch','capability.sandbox.propose','capability.sandbox.test'];
const RELEASE=[...BUILD,'pr.squash.merge','deploy.reversible'];
export const DEFAULT_OPERATIONS=Object.freeze({
 observe:Object.freeze(OBSERVE),build:Object.freeze(BUILD),release:Object.freeze(RELEASE)
});
const MODES=new Set(Object.keys(DEFAULT_OPERATIONS));
const OPS=new Set(RELEASE);
const LIMIT_BOUNDS={maxFiles:[1,64],maxFileBytes:[1000,100000],
 maxTotalBytes:[4000,500000],maxConcurrent:[1,8],maxSteps:[1,256]};
const PRESET_LIMITS={
 observe:{maxFiles:4,maxFileBytes:6500,maxTotalBytes:18000,maxConcurrent:1,maxSteps:8},
 build:{maxFiles:12,maxFileBytes:24000,maxTotalBytes:96000,maxConcurrent:4,maxSteps:32},
 release:{maxFiles:24,maxFileBytes:36000,maxTotalBytes:192000,maxConcurrent:4,maxSteps:48}
};
const KEYS=new Set(['db','expectedVersion','preset','allowedOperations','limits','reason']);
function invalid(){throw Error('invalid-autonomy-profile');}
function own(value){
 if(!value||typeof value!=='object'||Array.isArray(value))invalid();
 let fields;
 try{fields=Object.getOwnPropertyDescriptors(value);}catch{invalid();}
 const result={};
 for(const [k,d] of Object.entries(fields)){
  if(!d.enumerable||!Object.prototype.hasOwnProperty.call(d,'value'))invalid();
  Object.defineProperty(result,k,{value:d.value,enumerable:true,writable:true});
 }
 return result;
}
function parseOps(value,preset){
 if(value===undefined)return [...DEFAULT_OPERATIONS[preset]];
 if(!Array.isArray(value)||value.length===0||value.length>RELEASE.length)invalid();
 let slots;
 try{slots=Object.getOwnPropertyDescriptors(value);}catch{invalid();}
 if(slots.length?.value!==value.length)invalid();
 const selected=[];
 for(let i=0;i<value.length;i++){
  const d=slots[String(i)];
  if(!d?.enumerable||!Object.prototype.hasOwnProperty.call(d,'value')||!OPS.has(d.value))invalid();
  selected.push(d.value);
 }
 if(new Set(selected).size!==selected.length)invalid();
 return selected;
}
function parseLimits(value,preset){
 const overrides=value===undefined?{}:own(value);
 for(const key of Object.keys(overrides))if(!Object.hasOwn(LIMIT_BOUNDS,key))invalid();
 const limits={...PRESET_LIMITS[preset],...overrides};
 for(const [key,bounds] of Object.entries(LIMIT_BOUNDS)){
  const n=limits[key];
  if(!Number.isSafeInteger(n)||n<bounds[0]||n>bounds[1])invalid();
 }
 return limits;
}
export function normalizeOwnerProfile(row){
 const r=own(row);
 if(r.owner!==OWNER||!MODES.has(r.preset)||
   !Number.isSafeInteger(r.version)||r.version<1||
   !Number.isSafeInteger(r.stopVersion)||r.stopVersion<1||
   typeof r.paused!=='boolean'||r.maxPaidCents!==0)throw Error('autonomy-profile-unavailable');
 let operations,limits;
 try{operations=parseOps(r.allowedOperations,r.preset);
   limits=parseLimits(r.limits,r.preset);}catch{throw Error('autonomy-profile-unavailable');}
 return Object.freeze({
  schema:'ultron.owner-autonomy-control.v1',
  owner:r.owner,preset:r.preset,version:r.version,
  allowedOperations:Object.freeze(operations),
  limits:Object.freeze(limits),maxPaidCents:0,
  paused:r.paused,stopVersion:r.stopVersion,updatedAt:r.updatedAt||null,
  executionAuthorized:false,runtimeEnforced:false,
  releaseRequires:['authenticated-owner-grant','actual-capability-binding',
    'durable-stop-fence','idempotent-postcondition',
    'exact-head-ci','github-merge-eligibility','verified-rollback']
 });
}
const READ_SQL=[
 'SELECT a.owner,a.preset,a.allowed_operations AS "allowedOperations",',
 'a.limits,a.version,a.max_paid_cents AS "maxPaidCents",',
 'a.updated_at AS "updatedAt",c.paused,c.version AS "stopVersion"',
 'FROM brain_owner_autonomy_profile a',
 'JOIN brain_runtime_control c ON c.id=1',
 'WHERE a.id=1'
].join(' ');
export async function readOwnerProfile({db}={}){
 if(typeof db?.query!=='function')throw Error('autonomy-profile-unavailable');
 const response=await db.query(READ_SQL);
 if(!Array.isArray(response?.rows)||response.rows.length!==1)
  throw Error('autonomy-profile-unavailable');
 return normalizeOwnerProfile(response.rows[0]);
}
const UPDATE_SQL=[
 'WITH moved AS (UPDATE brain_owner_autonomy_profile a',
 'SET preset=$1,allowed_operations=$2::jsonb,limits=$3::jsonb,',
 'version=a.version+1,updated_at=now()',
 'FROM brain_runtime_control c WHERE a.id=1 AND a.version=$4',
 'AND c.id=1 AND c.paused=FALSE',
 'RETURNING a.version,a.preset),',
 'receipt AS (INSERT INTO brain_events(event_type,details)',
 "SELECT 'owner-autonomy-profile-updated',",
 "jsonb_build_object('version',version,'preset',preset,'reason',$5::text)",
 'FROM moved RETURNING id)',
 'SELECT moved.version,receipt.id AS "receiptId" FROM moved JOIN receipt ON true'
].join(' ');
/* Compare-and-swap preference only; this operation does not issue credentials. */
export async function setOwnerProfile(args={}){
 const p=own(args);
 if(Object.keys(p).some(k=>!KEYS.has(k))||
  !Number.isSafeInteger(p.expectedVersion)||p.expectedVersion<1||
  !MODES.has(p.preset)||typeof p.reason!=='string'||
  p.reason.trim().length<4||p.reason.trim().length>200)invalid();
 const ops=parseOps(p.allowedOperations,p.preset);
 const limits=parseLimits(p.limits,p.preset);
 if(typeof p.db?.query!=='function')invalid();
 let write,uncertain=false;
 try{
  write=await p.db.query(UPDATE_SQL,[p.preset,JSON.stringify(ops),
   JSON.stringify(limits),p.expectedVersion,p.reason.trim()]);
 }catch{uncertain=true;}
 let observed;
 try{observed=await readOwnerProfile({db:p.db});}
 catch{throw Error('autonomy-profile-write-uncertain');}
 const matches=observed.version===p.expectedVersion+1&&
  observed.preset===p.preset&&
  JSON.stringify(observed.allowedOperations)===JSON.stringify(ops)&&
  JSON.stringify(observed.limits)===JSON.stringify(limits);
 if(uncertain){
  if(!matches)throw Error('autonomy-profile-write-uncertain');
  return Object.freeze({ok:true,reconciled:true,receiptId:null,profile:observed});
 }
 if(!Array.isArray(write?.rows)||write.rows.length>1)
  throw Error('autonomy-profile-write-uncertain');
 if(write.rows.length===0)return Object.freeze({ok:false,error:'version-conflict'});
 if(!matches||write.rows[0]?.version!==observed.version||
  !Number.isSafeInteger(write.rows[0]?.receiptId))
  throw Error('autonomy-profile-write-uncertain');
 return Object.freeze({ok:true,reconciled:false,receiptId:write.rows[0].receiptId,profile:observed});
}
