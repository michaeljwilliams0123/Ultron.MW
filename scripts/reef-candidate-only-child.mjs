// Dedicated untrusted Reef candidate process.
// This process never receives signing keys, scoring rules or expected outcomes.
// Its stdout is *untrusted* diagnostics: parent must independently score.
// Not a full OS/container sandbox or proof against adversarial output forgery.
import {pathToFileURL} from 'node:url';
const nativeWrite=process.stdout.write.bind(process.stdout);
const nativeStringify=JSON.stringify.bind(JSON);
// Capture native matching primitives before importing untrusted candidate ESM.
// Candidate realm changes to String, RegExp.test, or RegExp.exec cannot turn
// unrelated exceptions into policy denials in this experimental worker.
const nativeApply=Reflect.apply;
const nativeExec=RegExp.prototype.exec;
const POLICY_DENIAL=/^(Repair plan rejected|Repair App identity readback invalid|Unified GitHub App identity readback invalid|Repair admission paused or revoked|Repair step denied)/;
const explicitDenial=message=>typeof message==='string'&&
  (message==='denied'||nativeApply(nativeExec,POLICY_DENIAL,[message])!==null);
let text='';
try{
 for await(const part of process.stdin){
  text+=part.toString('utf8');
  if(Buffer.byteLength(text)>8192)throw Error('case-request-too-large');
 }
 const request=JSON.parse(text);
 if(request?.method!=='admitRepairTask'||
    typeof request.completionNonce!=='string'||
    !/^[a-f0-9]{64}$/.test(request.completionNonce))
   throw Error('method-or-completion-invalid');
 // Never pass completionNonce to a candidate method or module scope.
 const modulePath=process.argv[2];
 if(!modulePath||!modulePath.endsWith('.mjs'))throw Error('candidate-missing');
 const candidate=await import(pathToFileURL(modulePath).href);
 if(typeof candidate.admitRepairTask!=='function')throw Error('candidate-invalid');
 let status='returned';
 try{await candidate.admitRepairTask(request.input);}
 catch(error){
  // A crash, bad import or programming error is NOT proof that the candidate
  // enforced a policy denial. Only explicit recognized denial errors can
  // produce a negative-case observation. This output remains untrusted.
  status=explicitDenial(error?.message)?'rejected':'invalid';
 }
 const response=Object.create(null);
 response.protocol='ultron.reef.untrusted-result.v1';
 response.status=status;
 response.completionNonce=request.completionNonce;
 nativeWrite(nativeStringify(response)+'\n');
}catch{
 nativeWrite(JSON.stringify({protocol:'ultron.reef.untrusted-result.v1',status:'invalid'})+'\n');
 process.exitCode=1;
}
