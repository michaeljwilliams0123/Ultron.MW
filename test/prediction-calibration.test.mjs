import test from 'node:test';
import assert from 'node:assert/strict';
import {registerForecast,evaluateForecastCalibration} from '../src/prediction-calibration.mjs';

const SHA='a'.repeat(40),HASH='b'.repeat(64);
const probs=[.9,.8,.2,.1,.5],events=[true,true,false,false,true];
function fixture(){
 const forecasts=probs.map((probability,i)=>registerForecast({
   taskId:'task-case-'+i,sourceSha:SHA,questionSha256:HASH,
   registrationReceiptId:'registration-'+i,
   forecastAt:'2026-10-20T00:00:00Z',resolveAfter:'2026-10-21T00:00:00Z',
   probability
 }));
 const outcomes=events.map((happened,i)=>({
   taskId:'task-case-'+i,outcomeReceiptId:'outcome-receipt-'+i,
   evidenceSha256:'c'.repeat(64),observedAt:'2026-10-22T00:00:00Z',happened
 }));
 const verifyEvidence=async({forecast,outcome})=>({
   verified:true,registrationReceiptId:forecast.registrationReceiptId,
   outcomeReceiptId:outcome.outcomeReceiptId,receiptDigest:'d'.repeat(64),
   verifierId:'external-github-readback'
 });
 return {forecasts,outcomes,verifyEvidence};
}
test('pre-registered and externally checked forecasts have deterministic Brier and calibration metrics',async()=>{
 const input=fixture();
 const report=await evaluateForecastCalibration(input);
 assert.equal(report.status,'evidence-admitted');
 assert.equal(report.counted,5);
 assert.equal(report.brier,.07);
 assert.equal(report.skillVersusHalfChance,.18);
 assert.equal(report.expectedCalibrationError,.22);
 assert.equal(report.outcomes.length,5);
 assert.match(report.fingerprint,/^[a-f0-9]{64}$/);
 const reversed=await evaluateForecastCalibration({...input,
   forecasts:[...input.forecasts].reverse(),outcomes:[...input.outcomes].reverse()});
 assert.deepEqual(reversed,report);
});
test('forecast records are immutable and cannot be changed after registration',async()=>{
 const input=fixture();
 const f=input.forecasts[0];
 assert.equal(Object.isFrozen(f),true);
 await assert.rejects(evaluateForecastCalibration({...input,
   forecasts:[{...f,probability:0.01},...input.forecasts.slice(1)]}),
   /forecast-fingerprint-mismatch/);
});
test('a model assertion is not a substitute for independent verifier acknowledgement',async()=>{
 const input=fixture();
 await assert.rejects(evaluateForecastCalibration({...input,verifyEvidence:undefined}),
   /calibration-evidence-contract-invalid/);
 await assert.rejects(evaluateForecastCalibration({...input,
   verifyEvidence:async()=>({verified:true})}),/independent-evidence-unverified/);
 await assert.rejects(evaluateForecastCalibration({...input,
   verifyEvidence:async()=>({verified:false})}),/independent-evidence-unverified/);
});
test('unverified or incorrect receipt correlation cannot enter a calibration score',async()=>{
 const input=fixture();
 await assert.rejects(evaluateForecastCalibration({...input,
   verifyEvidence:async()=>({verified:true,registrationReceiptId:'registration-incorrect',
     outcomeReceiptId:'outcome-receipt-0',receiptDigest:'d'.repeat(64),
     verifierId:'external-github-readback'})}),/independent-evidence-unverified/);
});
test('outcomes cannot precede the forecast resolution deadline',async()=>{
 const input=fixture();
 input.outcomes[0].observedAt='2026-10-20T12:00:00Z';
 await assert.rejects(evaluateForecastCalibration(input),/outcome-precedes-resolution/);
});
test('duplicate outcomes, hidden outcomes, and duplicate task forecasts fail closed',async()=>{
 const input=fixture();
 await assert.rejects(evaluateForecastCalibration({...input,
   outcomes:[input.outcomes[0],input.outcomes[0],...input.outcomes.slice(2)]}),
   /outcome-duplicate-or-unexpected/);
 await assert.rejects(evaluateForecastCalibration({...input,
   outcomes:input.outcomes.slice(1)}),/calibration-evidence-contract-invalid/);
 await assert.rejects(evaluateForecastCalibration({...input,
   forecasts:[input.forecasts[0],input.forecasts[0],...input.forecasts.slice(2)]}),
   /forecast-duplicate-task/);
});
test('a four-case, unverifiable retrospective does not meet the evaluation floor',async()=>{
 const input=fixture();
 await assert.rejects(evaluateForecastCalibration({...input,
   forecasts:input.forecasts.slice(0,4),outcomes:input.outcomes.slice(0,4)}),
   /calibration-evidence-contract-invalid/);
});

test('independent callback cannot mutate validated snapshots or alter subsequent scores',async()=>{
 const {forecasts,outcomes}=fixture();
 const mutableForecasts=forecasts.map(x=>({...x}));
 const mutableOutcomes=outcomes.map(x=>({...x}));
 const report=await evaluateForecastCalibration({
   forecasts:mutableForecasts,outcomes:mutableOutcomes,
   verifyEvidence:async({forecast,outcome})=>{
     assert.equal(Object.isFrozen(forecast),true);
     assert.equal(Object.isFrozen(outcome),true);
     mutableForecasts[0].probability=0;
     mutableOutcomes[0].happened=false;
     await Promise.resolve();
     return {verified:true,registrationReceiptId:forecast.registrationReceiptId,
       outcomeReceiptId:outcome.outcomeReceiptId,receiptDigest:'d'.repeat(64),
       verifierId:'external-github-readback'};
   }
 });
 assert.equal(report.brier,.07);
 assert.equal(report.outcomes[0].actual,1);
 assert.equal(report.outcomes[0].probability,.9);
});
test('audit lineage is deeply immutable after scoring',async()=>{
 const report=await evaluateForecastCalibration(fixture());
 assert.equal(Object.isFrozen(report.outcomes),true);
 assert.equal(Object.isFrozen(report.outcomes[0]),true);
 assert.throws(()=>{report.outcomes[0].actual=0;},TypeError);
 assert.throws(()=>{report.outcomes.push({});},TypeError);
});
test('invalid calendar dates cannot be normalized to valid evidence times',()=>{
 assert.throws(()=>registerForecast({
   taskId:'task-impossible-date',sourceSha:SHA,questionSha256:HASH,
   registrationReceiptId:'registration-impossible',
   forecastAt:'2026-02-30T00:00:00Z',resolveAfter:'2026-03-02T00:00:00Z',
   probability:.5
 }),/forecast-time-invalid/);
});
