// Isolated CI worker: production adapter, synthetic credential, loopback only.
import {runMahoragaAction} from '../../cloud/hatchable/lib/mahoraga-actions.js';

const origin=process.env.ULTRON_TEST_PROVIDER_ORIGIN;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin||''))throw Error('loopback-provider-required');
const action={key:'test:mahoraga-process-recovery',operation:'issue.create',input:{
 title:process.env.ULTRON_TEST_CHANGED_REQUEST==='1'?'Conflicting request':'Isolated recovery fixture',
 body:'Disposable HTTP provider fixture. No real GitHub write.',expectedMainSha:'a'.repeat(40)
}};
const config={async get(name){
 if(name==='ULTRON_MAHORAGA_CREDENTIAL_MODE')return 'pat';
 if(name==='ULTRON_MAHORAGA_CONNECTION1026')return 'github_pat_'+'CI_FIXTURE_ONLY_'.repeat(3);
 throw Error('no-real-credentials-in-this-fixture');
}};
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
const db={query(sql,params=[]){return new Promise((resolve,reject)=>{
 const id=++sequence;
 pending.set(id,{resolve,reject});
 process.send({type:'query',id,sql,params});
});}};
const transport=async(url,init)=>{
 const target=new URL(url);
 const prefix='/repos/michaeljwilliams0123/mahoraga';
 if(target.origin!=='https://api.github.com'||
    !(target.pathname===prefix||target.pathname.startsWith(prefix+'/')))
  throw Error('unexpected-provider-target');
 if(init.method==='POST'&&process.env.ULTRON_TEST_HOLD_BEFORE_POST==='1'){
  process.send({type:'before-provider-post'});
  await new Promise(()=>{}); // parent kills the process after durable send admission
 }
 // No token is forwarded, even though it is an explicitly synthetic fixture.
 return fetch(origin+target.pathname+target.search,{
  method:init.method,body:init.body,signal:init.signal,redirect:'error',
  headers:{'Content-Type':'application/json'}
 });
};
try{
 const result=await runMahoragaAction({db,config,transport},action);
 process.send({type:'result',result},()=>process.disconnect());
}catch(error){
 process.send({type:'worker-error',error:String(error.message)},()=>process.disconnect());
 process.exitCode=1;
}
