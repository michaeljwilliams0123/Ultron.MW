import {validateAuthorizationCallback} from './chatgpt-siwc-auth.mjs';

/**
 * Local, single-use OAuth callback gate.
 * Unsolicited local GETs and invalid state must never consume the pending
 * owner authorization. A correctly signed state is consumed before token
 * exchange, so an uncertain code exchange cannot replay the grant.
 */
export function createOneTimeSiwcCallback({attempt,consume}={}){
 if(!attempt?.state||!attempt?.redirectUri||
    typeof consume!=='function')
  throw Error('siwc-invalid-callback-gate');
 let finished=false;
 return Object.freeze({
  get finished(){return finished},
  async handle(url){
   if(finished)return {status:410,terminal:true,planEnabled:false};
   let payload;
   try{
    payload=validateAuthorizationCallback(url,attempt);
   }catch(e){
    const denied=e?.message==='siwc-user-declined-consent';
    if(denied)finished=true;
    return {status:400,terminal:denied,planEnabled:false,
     reason:denied?'siwc-user-declined-consent':'siwc-invalid-callback'};
   }
   finished=true;
   try{
    const result=await consume(payload);
    return {status:200,terminal:true,planEnabled:result?.planEnabled===true};
   }catch{
    return {status:400,terminal:true,planEnabled:false,
     reason:'siwc-exchange-or-custody-unverified'};
   }
  }
 });
}
