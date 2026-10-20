import { appendFile } from 'node:fs/promises';

const SHA=/^[a-f0-9]{40}$/;
const HOSTS=Object.freeze({
  'datadoghq.com':'http-intake.logs.datadoghq.com',
  'datadoghq.eu':'http-intake.logs.datadoghq.eu',
  'us3.datadoghq.com':'http-intake.logs.us3.datadoghq.com',
  'us5.datadoghq.com':'http-intake.logs.us5.datadoghq.com',
  'ap1.datadoghq.com':'http-intake.logs.ap1.datadoghq.com',
  'ap2.datadoghq.com':'http-intake.logs.ap2.datadoghq.com',
  'uk1.datadoghq.com':'http-intake.logs.uk1.datadoghq.com'
});
const IDENT=/^[a-z][a-z0-9-]{0,49}$/;

/** Controlled schema excludes source, prompts, secrets, and raw responses. */
export function executionEvent(input={}) {
  const kind=String(input.kind||'unknown');
  const state=String(input.state||'unknown');
  const intent=String(input.intent||'unknown');
  const sha=input.sha;
  return Object.freeze({
    schema:'ultron-execution-v1',
    service:'ultron-pr-brain',
    kind:IDENT.test(kind)?kind:'unknown',
    state:IDENT.test(state)?state:'unknown',
    intent:IDENT.test(intent)?intent:'unknown',
    sha:typeof sha==='string'&&SHA.test(sha)?sha:null,
    prNumber:Number.isSafeInteger(input.prNumber)&&input.prNumber>0?input.prNumber:null,
    runId:Number.isSafeInteger(input.runId)&&input.runId>0?input.runId:null,
    checksSucceeded:Number.isSafeInteger(input.checksSucceeded)?input.checksSucceeded:null,
    checksFailed:Number.isSafeInteger(input.checksFailed)?input.checksFailed:null,
    observedAt:new Date(input.observedAt||Date.now()).toISOString(),
  });
}
/** Native GitHub summary first; optional Datadog only with explicit owner config. */
export async function publishTelemetry(event,{
  env=process.env,fetchImpl=fetch,append=appendFile,
  summaryPath=env.GITHUB_STEP_SUMMARY,
}={}) {
  const payload=executionEvent(event);
  if(summaryPath)await append(summaryPath,
    '\n### Ultron execution telemetry\n\n'+JSON.stringify(payload)+'\n');
  if(env.ULTRON_ENABLE_DATADOG!=='1')
    return {state:'disabled',event:payload};
  const key=env.ULTRON_DATADOG_API_KEY;
  if(typeof key!=='string'||key.length<16)
    return {state:'authorization-required',event:payload};
  const host=HOSTS[env.ULTRON_DATADOG_SITE||'datadoghq.com'];
  if(!host)return {state:'site-unapproved',event:payload};
  try {
    const response=await fetchImpl('https://'+host+'/api/v2/logs',{
      method:'POST',
      headers:{'Content-Type':'application/json','DD-API-KEY':key},
      body:JSON.stringify([{
        ddsource:'github-actions',
        service:'ultron-pr-brain',
        hostname:'github-actions',
        status:payload.state==='succeeded'?'info':'warning',
        message:'Ultron structured execution observation',
        ultron:payload
      }]),
      signal:AbortSignal.timeout(8000),
    });
    return {state:response.ok?'delivered':'rejected',statusCode:response.status,event:payload};
  } catch {
    return {state:'unavailable',event:payload};
  }
}
