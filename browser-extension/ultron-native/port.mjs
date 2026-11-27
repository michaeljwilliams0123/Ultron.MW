const HOST='com.ultron.browser';
/** One user-initiated exchange. A lost response after sending is uncertain,
 * not evidence that execution failed. Never retry or open a second port. */
export async function exchangeNativeRead({runtime,client,task,timeoutMs=30000}={}){
 if(typeof runtime?.connectNative!=='function'||typeof client?.signRead!=='function'||
    typeof client?.verifyReceipt!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)
   throw Error('Invalid native exchange configuration');
 return new Promise(resolve=>{
  const deadline=performance.now()+timeoutMs;
  const expired=()=>performance.now()>=deadline;
  let port,timer,finished=false,phase='challenge',sent=false;
  const finish=result=>{
   if(finished)return;
   finished=true;clearTimeout(timer);
   if(port){
    port.onMessage.removeListener(onMessage);port.onDisconnect.removeListener(onDisconnect);
    try{port.disconnect();}catch{}
   }
   resolve(result);
  };
  const uncertain=()=>finish({status:sent?'reconcile-required':'held',reason:sent?'native-outcome-unverified':'native-unavailable'});
  const onDisconnect=()=>{void runtime.lastError;if(phase!=='verifying')uncertain();};
  const onMessage=async message=>{
   if(finished)return;
   if(expired())return uncertain();
   if(phase==='challenge'){
    phase='signing';
    try{
     const request=await client.signRead(message,task);
     if(finished)return;
     if(expired())return uncertain();
     phase='receipt';sent=true;
     port.postMessage(request);
    }catch{uncertain();}
   }else if(phase==='receipt'){
    phase='verifying';
    try{const receipt=await client.verifyReceipt(message);if(!finished){if(expired())uncertain();else finish(receipt);}}
    catch{uncertain();}
   }else{uncertain();}
  };
  try{
   port=runtime.connectNative(HOST);
   port.onMessage.addListener(onMessage);port.onDisconnect.addListener(onDisconnect);
   timer=setTimeout(uncertain,Math.max(0,deadline-performance.now()));
  }catch{uncertain();}
 });
}
