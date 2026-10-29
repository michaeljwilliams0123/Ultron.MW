// Disposable subprocess for the PostgreSQL crash tests. Never deployed.
import {readFile} from 'node:fs/promises';

let sequence=0;
const pending=new Map();
process.on('message',message=>{
 if(message.type!=='query-result')return;
 const request=pending.get(message.id);
 if(!request)return;
 pending.delete(message.id);
 if(message.error)request.reject(Error(message.error));
 else request.resolve({rows:message.rows});
});
const db={query(sql,params=[]){
 return new Promise((resolve,reject)=>{
  const id=++sequence;
  pending.set(id,{resolve,reject});
  process.send({type:'query',id,sql,params});
 });
}};
globalThis.processTestObjective=async objective=>{
 process.send({type:'objective-entered',objective});
 if(process.env.ULTRON_HOLD_OBJECTIVE==='1'){
  await new Promise(resolve=>{
   function release(message){
    if(message.type!=='release-objective')return;
    process.off('message',release);
    resolve();
   }
   process.on('message',release);
  });
 }
 return {objective,source:'isolated-process-fixture',sha:'a'.repeat(40)};
};
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const control=moduleUrl(await readFile(new URL('../../cloud/hatchable/lib/runtime-control.js',import.meta.url),'utf8'));
const fixture=moduleUrl('export const executeObjective=globalThis.processTestObjective;');
const source=await readFile(new URL('../../cloud/hatchable/lib/brain-runner.js',import.meta.url),'utf8');
const runner=source.replace("from 'lib/brain-core.js'","from '"+fixture+"'")
 .replace("from 'lib/runtime-control.js'","from '"+control+"'");
try{
 const {runOne}=await import(moduleUrl(runner));
 const result=await runOne({db,browser:{}});
 process.send({type:'result',result},()=>process.disconnect());
}catch(error){
 process.send({type:'worker-error',error:String(error.message)},()=>process.disconnect());
 process.exitCode=1;
}
