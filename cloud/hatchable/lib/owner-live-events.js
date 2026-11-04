// Realtime is a hint, never a substitute for the committed PostgreSQL state.
// Do not include notes, tokens, identities, arbitrary user strings or results.
const KINDS=new Set(['task','runtime','profile','github','note']);
export async function notifyOwner(events,kind,id){
 if(!KINDS.has(kind)||id!=null&&(!Number.isSafeInteger(id)||id<=0))return false;
 if(!events||typeof events.publish!=='function')return false;
 const payload=id==null?{kind}:{kind,id};
 try{
  await events.publish('ultron.owner','changed',payload);
  return true;
 }catch{
  // The caller must preserve its successful durable write, not replay it.
  return false;
 }
}
