import { createHash } from 'node:crypto';

const SHA40=/^[a-f0-9]{40}$/;
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9_.:-]{5,95}$/;
const RECEIPT=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,160}$/;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(new TypeError(code),{code});};
const time=(s,code)=>{
  if(typeof s!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s))
    fail(code);
  const parsed=Date.parse(s);
  const canonical=s.includes('.')?s:s.slice(0,-1)+'.000Z';
  // Date.parse may normalize impossible dates such as February 30.
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==canonical)fail(code);
  return parsed;
};
function validForecast(f) {
  if(!f||f.schema!=='ultron.probabilistic-forecast.v1'||!ID.test(f.taskId||'')||
    !SHA40.test(f.sourceSha||'')||!HASH.test(f.questionSha256||'')||
    !RECEIPT.test(f.registrationReceiptId||'')||typeof f.probability!=='number'||
    !Number.isFinite(f.probability)||f.probability<0||f.probability>1||
    time(f.forecastAt,'forecast-time-invalid')>=time(f.resolveAfter,'forecast-time-invalid'))
    fail('forecast-invalid');
  const {fingerprint,...core}=f;
  if(!HASH.test(fingerprint||'')||hash(core)!==fingerprint)fail('forecast-fingerprint-mismatch');
  return f;
}
/** Creates a forecast record, not a trusted timestamp attestation. Registration
 * must separately be persisted in a source the predictor cannot rewrite. */
export function registerForecast({
 taskId,sourceSha,questionSha256,registrationReceiptId,
 forecastAt,resolveAfter,probability
}={}) {
  const core={schema:'ultron.probabilistic-forecast.v1',taskId,sourceSha,
    questionSha256,registrationReceiptId,forecastAt,resolveAfter,probability};
  const record={...core,fingerprint:hash(core)};
  validForecast(record);
  return Object.freeze(record);
}
function validOutcome(o){
  if(!o||!ID.test(o.taskId||'')||!RECEIPT.test(o.outcomeReceiptId||'')||
    typeof o.happened!=='boolean'||!HASH.test(o.evidenceSha256||''))
    fail('outcome-invalid');
  time(o.observedAt,'outcome-time-invalid');
  return o;
}
/** The injected verifier must be a separately authorized, source-of-truth
 * readback adapter. A locally supplied callback alone is not cryptographic
 * attestation. The routine never requests work, grants authority, or trains AI. */
export async function evaluateForecastCalibration({
  forecasts,outcomes,verifyEvidence
}={}) {
  if(!Array.isArray(forecasts)||forecasts.length<5||forecasts.length>1000||
    !Array.isArray(outcomes)||outcomes.length!==forecasts.length||
    typeof verifyEvidence!=='function')fail('calibration-evidence-contract-invalid');
  const prior=new Map(),results=new Map();
  for(const f of forecasts){
    // Snapshot before validation and BEFORE any awaited verifier callback.
    // External JSON objects may be mutable and must never affect scoring.
    const stable=Object.freeze({...f});
    validForecast(stable);
    if(prior.has(stable.taskId))fail('forecast-duplicate-task');
    prior.set(stable.taskId,stable);
  }
  for(const o of outcomes){
    const stable=Object.freeze({...o});
    validOutcome(stable);
    if(results.has(stable.taskId)||!prior.has(stable.taskId))fail('outcome-duplicate-or-unexpected');
    results.set(stable.taskId,stable);
  }
  const cases=[];
  for(const id of [...prior.keys()].sort()){
    const f=prior.get(id),o=results.get(id);
    if(!o||Date.parse(o.observedAt)<Date.parse(f.resolveAfter)||
       Date.parse(o.observedAt)<=Date.parse(f.forecastAt))
      fail('outcome-precedes-resolution');
    // A source adapter must prove the timestamped preregistration AND
    // completed outcome. No self-reported model confidence is accepted.
    const proof=await verifyEvidence(Object.freeze({forecast:f,outcome:Object.freeze({...o})}));
    if(!proof||proof.verified!==true||
       proof.registrationReceiptId!==f.registrationReceiptId||
       proof.outcomeReceiptId!==o.outcomeReceiptId||
       !HASH.test(proof.receiptDigest||'')||
       !ID.test(proof.verifierId||'')||proof.verifierId===f.taskId)
      fail('independent-evidence-unverified');
    cases.push(Object.freeze({taskId:id,probability:f.probability,actual:Number(o.happened),
      sourceSha:f.sourceSha,registrationReceiptId:f.registrationReceiptId,
      outcomeReceiptId:o.outcomeReceiptId,proofDigest:proof.receiptDigest}));
  }
  const count=cases.length;
  const brier=cases.reduce((n,c)=>n+(c.probability-c.actual)**2,0)/count;
  const buckets=Array.from({length:4},()=>[]);
  for(const c of cases)buckets[Math.min(3,Math.floor(c.probability*4))].push(c);
  const calibrationError=buckets.reduce((n,group)=>{
    if(!group.length)return n;
    const mean=k=>group.reduce((sum,x)=>sum+x[k],0)/group.length;
    return n+Math.abs(mean('probability')-mean('actual'))*group.length/count;
  },0);
  const core={schema:'ultron.forecast-calibration.v1',status:'evidence-admitted',
    counted:count,baselineBrier:0.25,brier:Number(brier.toFixed(8)),
    skillVersusHalfChance:Number((0.25-brier).toFixed(8)),
    expectedCalibrationError:Number(calibrationError.toFixed(8)),
    outcomes:Object.freeze(cases)};
  // A calibration result is an audit artifact, not AGI, self-awareness,
  // independent certification, or permission for automatic promotion.
  return Object.freeze({...core,fingerprint:hash(core)});
}
