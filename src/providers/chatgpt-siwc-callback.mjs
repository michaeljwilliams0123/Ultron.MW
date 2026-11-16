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
   }catch(e){
    const safeReasons=new Set(['siwc-provider-unavailable','siwc-oauth-token-invalid',
     'siwc-id-token-format-invalid','siwc-id-token-algorithm-invalid',
     'siwc-id-token-provider-mismatch','siwc-id-token-key-invalid',
     'siwc-id-token-signature-invalid','siwc-id-token-claims-invalid',
     'siwc-id-token-issuer-invalid','siwc-id-token-nonce-invalid',
     'siwc-id-token-audience-invalid','siwc-id-token-subject-invalid',
     'siwc-id-token-expiration-invalid','siwc-id-token-issued-at-invalid',
     'siwc-id-token-not-before-invalid',
     'chatgpt-plan-account-mismatch','chatgpt-plan-private-storage-unavailable']);
    return {status:400,terminal:true,planEnabled:false,
     reason:safeReasons.has(e?.message)?e.message:'siwc-exchange-or-custody-unverified'};
   }
  }
 });
}
