/**
 * Owner-customizable, source-only autonomy envelopes.
 * A profile is a versioned policy PLAN, not a credential, runtime grant,
 * GitHub approval, production state, or permission to spend.
 *
 * Runtime adapters must independently verify identity, scope, owner consent,
 * stop state, idempotency, CI and external readback BEFORE acting.
 */
import {createHash} from 'node:crypto';

const OWNER='michaeljwilliams0123';
const ID=/^[a-z0-9][a-z0-9_.:-]{7,127}$/;
const TIME=/^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const PRESETS=Object.freeze({
  observe:Object.freeze({
    operations:['research.public','repo.inspect','plan.create','test.local','evidence.read'],
    limits:{maxFiles:4,maxFileBytes:6500,maxTotalBytes:18000,maxConcurrent:1,maxSteps:8},
  }),
  build:Object.freeze({
    operations:['research.public','repo.inspect','plan.create','test.local','evidence.read',
      'branch.create','branch.update','pr.open','pr.comment','verify.dispatch',
      'capability.sandbox.propose','capability.sandbox.test'],
    limits:{maxFiles:12,maxFileBytes:24000,maxTotalBytes:96000,maxConcurrent:4,maxSteps:32},
  }),
  release:Object.freeze({
    operations:['research.public','repo.inspect','plan.create','test.local','evidence.read',
      'branch.create','branch.update','pr.open','pr.comment','verify.dispatch',
      'capability.sandbox.propose','capability.sandbox.test',
      'pr.squash.merge','deploy.reversible'],
    limits:{maxFiles:24,maxFileBytes:36000,maxTotalBytes:192000,maxConcurrent:4,maxSteps:48},
  }),
});
const ALL=Object.freeze([...new Set(Object.values(PRESETS)
  .flatMap(p=>p.operations))].sort());
export const OWNER_AUTONOMY_OPERATIONS=ALL;
const KNOWN=new Set(ALL);
const STEP_UP=new Set(['admin.modify','credential.create','credential.rotate',
  'permissions.widen','billing.spend','external.irreversible']);
const FORBIDDEN=new Set(['pr.self.approve','protected.main.force-push']);
const LIMITS=Object.freeze({maxFiles:[1,64],maxFileBytes:[1000,100000],
  maxTotalBytes:[4000,500000],maxConcurrent:[1,8],maxSteps:[1,256]});
const TOP=new Set(['preset','owner','objectiveId','revision','expiresAt',
  'allowedOperations','limits','paidSpendCeilingCents']);
const trusted=new WeakSet();

function dayTime(s){
  if(typeof s!=='string')return NaN;
  const m=TIME.exec(s);
  if(!m)return NaN;
  const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(day<1||day>(days[month-1]??0))return NaN;
  return Date.parse(s);
}
function ownData(value,fields=null){
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw Error('Invalid autonomy configuration');
  let entries;
  try{entries=Object.getOwnPropertyDescriptors(value);}
  catch{throw Error('Invalid autonomy configuration');}
  const keys=fields??Object.keys(entries);
  const result=Object.create(null);
  for(const k of keys){
    const desc=entries[k];
    if(!desc?.enumerable||!Object.hasOwn(desc,'value'))
      throw Error('Invalid autonomy configuration');
    result[k]=desc.value;
  }
  return result;
}
function cleanOps(value){
  if(!Array.isArray(value)||value.length<1||value.length>ALL.length)
    throw Error('Invalid autonomy operations');
  let d;
  try{d=Object.getOwnPropertyDescriptors(value);}
  catch{throw Error('Invalid autonomy operations');}
  if(d.length?.value!==value.length)throw Error('Invalid autonomy operations');
  const ops=[];
  for(let i=0;i<value.length;i++){
    const slot=d[String(i)];
    if(!slot?.enumerable||!Object.hasOwn(slot,'value')||
      !KNOWN.has(slot.value))throw Error('Invalid autonomy operations');
    ops.push(slot.value);
  }
  if(new Set(ops).size!==ops.length)throw Error('Invalid autonomy operations');
  return ops.sort();
}
function cleanLimits(defaults,delta){
  const overrides=delta===undefined?{}:ownData(delta);
  if(Object.keys(overrides).some(k=>!Object.hasOwn(LIMITS,k)))
    throw Error('Invalid autonomy limits');
  const selected={...defaults,...overrides};
  for(const [key,v] of Object.entries(selected)){
    const [min,max]=LIMITS[key];
    if(!Number.isSafeInteger(v)||v<min||v>max)
      throw Error('Invalid autonomy limits');
  }
  return Object.freeze(selected);
}
function decision(disposition,reason,requiredRuntimeChecks=[]){
  return Object.freeze({disposition,reason,
    requiredRuntimeChecks:Object.freeze([...requiredRuntimeChecks]),
    executionAuthorized:false,productionAccepted:false,
  });
}
/** A constrained custom policy, never independently verified owner consent. */
export function createOwnerAutonomyProfile(input={}){
  const p=ownData(input);
  if(Object.keys(p).some(k=>!TOP.has(k))||
    !Object.hasOwn(PRESETS,p.preset)||p.owner!==OWNER||
    typeof p.objectiveId!=='string'||!ID.test(p.objectiveId)||
    !Number.isSafeInteger(p.revision)||p.revision<1||
    !Number.isFinite(dayTime(p.expiresAt))||
    p.paidSpendCeilingCents!==undefined&&p.paidSpendCeilingCents!==0)
    throw Error('Invalid autonomy profile');
  const allowedOperations=Object.freeze(cleanOps(
    p.allowedOperations??PRESETS[p.preset].operations));
  const limits=cleanLimits(PRESETS[p.preset].limits,p.limits);
  const manifest={schema:'ultron.owner-autonomy.v1',
    preset:p.preset,owner:p.owner,objectiveId:p.objectiveId,
    revision:p.revision,expiresAt:p.expiresAt,
    allowedOperations,limits,paidSpendCeilingCents:0};
  const digest=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const profile=Object.freeze({...manifest,digest});
  trusted.add(profile);
  return profile;
}
/**
 * Preflight only: 'routine-preflight-eligible' removes redundant planning
 * prompts but never authorizes execution. The runtime must check every
 * listed gate using trusted, independently read data.
 */
export function assessOwnerAutonomyRequest({
  profile,operation,objectiveId,now,controls,estimatedPaidCents
}={}){
  if(!trusted.has(profile))return decision('held','untrusted-profile');
  if(typeof operation!=='string'||!operation||
    typeof objectiveId!=='string'||objectiveId!==profile.objectiveId)
    return decision('held','invalid-operation-or-objective');
  if(FORBIDDEN.has(operation))
    return decision('held','protected-operation');
  if(STEP_UP.has(operation))
    return decision('owner-step-up-required','independent-owner-authorization');
  if(!profile.allowedOperations.includes(operation))
    return decision('held','operation-out-of-profile');
  const current=dayTime(now);
  if(!Number.isFinite(current)||current>=dayTime(profile.expiresAt)||
    controls?.paused!==false||controls?.revoked!==false)
    return decision('held','profile-expired-or-stopped');
  if(estimatedPaidCents!==0)
    return decision('held','paid-operation-not-permitted');
  const checks=['authenticated-owner-grant','capability-binding-readback',
    'durable-stop-and-fence','idempotency-and-postcondition','zero-paid-spend'];
  if(['pr.squash.merge','deploy.reversible'].includes(operation)){
    checks.push('independent-review','exact-head-ci','github-merge-eligibility');
    if(operation==='deploy.reversible')checks.push('verified-rollback');
  }
  return decision('routine-preflight-eligible','policy-profile-matched',checks);
}
