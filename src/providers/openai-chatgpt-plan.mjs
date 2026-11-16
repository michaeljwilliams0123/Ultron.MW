/**
 * OpenAI Sign in with ChatGPT (SIWC) open-source owner-host provider.
 *
 * Not an API-key provider, not a ChatGPT backend-api proxy, and not an
 * authorization to place credentials in hosted Actions/Hatchable. Caller
 * must supply an OIDC-validated, owner-consented SIWC credential from a
 * protected local/self-hosted credential store.
 *
 * Official contract: https://developers.openai.com/siwc/token-sharing-open-source
 */
const ROOT='https://api.openai.com/v1';
const MODEL=/^[a-zA-Z][a-zA-Z0-9._-]{1,100}$/;
const SCOPE='chatgpt.tokens.use.direct';
const UNAVAILABLE=new Set([
 'subscription_sharing_usage_limit_exceeded',
 'subscription_sharing_usage_unavailable'
]);
const MAX_REPLY=16000;
const MAX_BYTES=256000;

function requireCredential(credential,now=Date.now()){
 const scopes=Array.isArray(credential?.scope)?credential.scope:
  typeof credential?.scope==='string'?credential.scope.split(/\s+/):[];
 if(credential?.kind!=='chatgpt-plan-oauth'||
    credential?.issuer!=='https://auth.openai.com'||
    typeof credential?.subject!=='string'||credential.subject.length<1||
    typeof credential?.client_id!=='string'||!credential.client_id.startsWith('oaiapp_')||
    !scopes.includes(SCOPE)||!scopes.includes('resource.invoke')||
    typeof credential?.access_token!=='string'||
    credential.access_token.length<20||credential.access_token.length>8192||
    credential.access_token.startsWith('sk-')||
    /\s/.test(credential.access_token)||
    !Number.isSafeInteger(credential?.expires_in)||credential.expires_in<=0||
    !Number.isFinite(Date.parse(credential?.saved_at||''))||
    Date.parse(credential.saved_at)+credential.expires_in*1000<=now+30000)
   throw Error('chatgpt-plan-consent-or-session-unavailable');
 return credential.access_token;
}

export async function listChatgptPlanModels({
 credential,fetchImpl=fetch,now=Date.now()
}={}){
 const token=requireCredential(credential,now);
 const response=await fetchImpl(ROOT+'/models',{
  method:'GET',
  headers:{authorization:'Bearer '+token,accept:'application/json'},
  signal:AbortSignal.timeout(8000)
 });
 if(!response?.ok)throw Error('chatgpt-plan-catalog-unavailable');
 const result=await response.json();
 if(!Array.isArray(result?.models))throw Error('chatgpt-plan-catalog-invalid');
 return result.models.filter(x=>x?.visibility==='list'&&MODEL.test(x.slug||'')&&
  typeof x.display_name==='string'&&x.display_name.length>0)
  .map(x=>Object.freeze({slug:x.slug,display_name:x.display_name}));
}

function parseStreamEvent(raw){
 const data=raw.split('\n').map(l=>l.trimEnd())
  .filter(line=>line.startsWith('data:'))
  .map(line=>line.slice(5).trimStart()).join('\n');
 if(!data||data==='[DONE]')return null;
 try{return JSON.parse(data)}catch{throw Error('chatgpt-plan-invalid-event')}
}

/**
 * The plan-sharing Responses preview requires store:false + stream:true,
 * input as an array, and no API-only fields such as max_output_tokens.
 */
export async function invokeChatgptPlan({
 credential,model,input,instructions,fetchImpl=fetch,now=Date.now()
}={}){
 const token=requireCredential(credential,now);
 if(!MODEL.test(model||'')||
    typeof input!=='string'||!input.trim()||input.length>6000||
    typeof instructions!=='string'||!instructions.trim()||
    instructions.length>1800)
   throw Error('chatgpt-plan-prompt-invalid');
 const models=await listChatgptPlanModels({credential,fetchImpl,now});
 if(!models.some(m=>m.slug===model))throw Error('chatgpt-plan-model-not-available');
 const response=await fetchImpl(ROOT+'/responses',{
  method:'POST',
  headers:{authorization:'Bearer '+token,'content-type':'application/json',
   accept:'text/event-stream'},
  body:JSON.stringify({model,instructions,
   input:[{role:'user',content:input}],store:false,stream:true}),
  signal:AbortSignal.timeout(40000)
 });
 if(!response?.ok)throw Error('chatgpt-plan-response-unavailable');
 if(typeof response.body?.getReader!=='function')
  throw Error('chatgpt-plan-stream-required');
 const reader=response.body.getReader();
 const decoder=new TextDecoder();
 let data='',text='',total=0,completed=false;
 try{
  for(;;){
   const next=await reader.read();
   if(next.done)break;
   total+=next.value.byteLength;
   if(total>MAX_BYTES)throw Error('chatgpt-plan-stream-too-large');
   data+=decoder.decode(next.value,{stream:true}).replace(/\r\n/g,'\n');
   while(data.includes('\n\n')){
    const boundary=data.indexOf('\n\n'),raw=data.slice(0,boundary);
    data=data.slice(boundary+2);
    const event=parseStreamEvent(raw);
    if(!event)continue;
    if(event.type==='response.output_text.delta'){
     if(completed||typeof event.delta!=='string')
      throw Error('chatgpt-plan-unexpected-delta');
     text+=event.delta;
     if(text.length>MAX_REPLY)throw Error('chatgpt-plan-output-too-large');
    }else if(event.type==='response.failed'){
     const code=event.response?.error?.code;
     if(UNAVAILABLE.has(code))throw Error(code);
     throw Error('chatgpt-plan-response-failed');
    }else if(event.type==='response.incomplete'){
     throw Error('chatgpt-plan-response-incomplete');
    }else if(event.type==='response.completed'){
     if(completed||event.response?.status!=='completed')
      throw Error('chatgpt-plan-invalid-terminal');
     completed=true;
    }
   }
  }
 }finally{
  reader.releaseLock();
 }
 if(!completed||!text.trim())throw Error('chatgpt-plan-not-completed');
 return text.trim();
}
