// Dedicated untrusted Reef candidate process.
// This process never receives signing keys, scoring rules or expected outcomes.
// Its stdout is *untrusted* diagnostics: parent must independently score.
// Not a full OS/container sandbox or proof against adversarial output forgery.
import {pathToFileURL} from 'node:url';
const nativeWrite=process.stdout.write.bind(process.stdout);
let text='';
try{
 for await(const part of process.stdin){
  text+=part.toString('utf8');
  if(Buffer.byteLength(text)>8192)throw Error('case-request-too-large');
 }
 const request=JSON.parse(text);
 if(request?.method!=='admitRepairTask')throw Error('method-not-allowed');
 const modulePath=process.argv[2];
 if(!modulePath||!modulePath.endsWith('.mjs'))throw Error('candidate-missing');
 const candidate=await import(pathToFileURL(modulePath).href);
 if(typeof candidate.admitRepairTask!=='function')throw Error('candidate-invalid');
 let status='returned';
 try{await candidate.admitRepairTask(request.input);}
 catch{status='rejected';}
 nativeWrite(JSON.stringify({protocol:'ultron.reef.untrusted-result.v1',status})+'\n');
}catch{
 nativeWrite(JSON.stringify({protocol:'ultron.reef.untrusted-result.v1',status:'invalid'})+'\n');
 process.exitCode=1;
}
