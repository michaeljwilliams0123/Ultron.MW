/** Phase 4: free-tier model reasoning with honest provenance.
 * Gemini (primary) -> Groq (secondary) -> explicit deterministic fallback.
 * Public/synthetic input only. No paid fallback, ever. */
import {createHash} from 'node:crypto';

export const PROVIDERS=Object.freeze({
 google:{id:'google',model:'gemini-3.5-flash-lite',keyEnv:'GEMINI_API_KEY',
  url:m=>'https://generativelanguage.googleapis.com/v1beta/models/'+m+':generateContent'},
 groq:{id:'groq',model:'openai/gpt-oss-20b',keyEnv:'GROQ_API_KEY',
  url:()=>'https://api.groq.com/openai/v1/chat/completions'}
});
export const REASONING_ROLES=Object.freeze({
 Builder:'You are Builder. Propose the smallest concrete change that satisfies the request. List steps and risks.',
 Skeptic:'You are Skeptic. Challenge the proposal: name the weakest assumption, a falsifying test, and any disagreement.',
 Sentinel:'You are Sentinel. Check only material security risks (secrets, injection, privilege, supply chain). Say "none material" if none.'
});
const VERDICTS=['proceed','hold','revise'];
const SECRET=/(ghp_|gho_|ghs_|github_pat_|sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|gsk_[A-Za-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abp]-|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.)/;
const PRIVATE=/\b(mahoraga[-_ ]?private|confidential|internal[-_ ]only|do not share)\b/i;

/** Gate: only public/synthetic text may leave the trust boundary. */
export function checkExternalInput(text,{maxChars=6000}={}){
 if(typeof text!=='string'||!text.trim())return{ok:false,reason:'empty'};
 if(text.length>maxChars)return{ok:false,reason:'too-long'};
 if(SECRET.test(text))return{ok:false,reason:'secret-like'};
 if(PRIVATE.test(text))return{ok:false,reason:'private-marker'};
 return{ok:true};
}

export function parseVerdict(raw){
 const m=String(raw||'').match(/\{[\s\S]*\}/);
 if(!m)return null;
 try{const o=JSON.parse(m[0]);
  if(!VERDICTS.includes(o.verdict))return null;
  return{verdict:o.verdict,confidence:Math.min(1,Math.max(0,Number(o.confidence)||0)),
   rationale:String(o.rationale||'').slice(0,1200),disagreements:Array.isArray(o.disagreements)?o.disagreements.slice(0,5).map(String):[]};
 }catch{return null}
}

function buildRequest(p,role,input){
 const system=REASONING_ROLES[role]+' Reply ONLY with JSON: {"verdict":"proceed|hold|revise","confidence":0-1,"rationale":"...","disagreements":[]}.';
 if(p.id==='google')return{body:{systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:input}]}],generationConfig:{temperature:0.2,maxOutputTokens:600}}};
 return{body:{model:p.model,temperature:0.2,max_tokens:600,messages:[{role:'system',content:system},{role:'user',content:input}]}};
}
function extractText(p,j){
 return p.id==='google'?j?.candidates?.[0]?.content?.parts?.map(x=>x.text).join('')||'':j?.choices?.[0]?.message?.content||'';
}
function rateLimits(h){
 const g=k=>h?.get?.(k)??null;
 return{remainingRequests:g('x-ratelimit-remaining-requests'),remainingTokens:g('x-ratelimit-remaining-tokens'),retryAfter:g('retry-after')};
}

/** One role invocation. Returns a record whose `source` says what really ran. */
export async function reasonAsRole({role,input,env=process.env,fetchImpl=fetch,order=['google','groq'],deterministic}){
 if(!REASONING_ROLES[role])throw Error('reasoning-role-invalid');
 const inputDigest=createHash('sha256').update(String(input)).digest('hex');
 const gate=checkExternalInput(input);
 const base={schema:'ultron.council-reasoning.v1',role,inputDigest,paidInference:false,attempts:[]};
 if(!gate.ok)return fallback(base,'input-blocked:'+gate.reason,deterministic);
 for(const id of order){
  const p=PROVIDERS[id];const key=env[p.keyEnv];
  if(!key){base.attempts.push({provider:id,model:p.model,outcome:'no-credential'});continue}
  const t0=Date.now();
  try{
   const {body}=buildRequest(p,role,input);
   const headers={'content-type':'application/json'};
   let url=p.url(p.model);
   if(id==='google')headers['x-goog-api-key']=key;else headers.authorization='Bearer '+key;
   const r=await fetchImpl(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
   const limits=rateLimits(r.headers);
   if(r.status===429||r.status===503){base.attempts.push({provider:id,model:p.model,outcome:'rate-limited',status:r.status,limits});continue}
   if(!r.ok){base.attempts.push({provider:id,model:p.model,outcome:'http-'+r.status,limits});continue}
   const parsed=parseVerdict(extractText(p,await r.json()));
   if(!parsed){base.attempts.push({provider:id,model:p.model,outcome:'unparseable',limits});continue}
   base.attempts.push({provider:id,model:p.model,outcome:'ok',limits,ms:Date.now()-t0});
   return Object.freeze({...base,source:'model',modelInvoked:true,provider:id,modelId:p.model,...parsed});
  }catch(e){base.attempts.push({provider:id,model:p.model,outcome:'error',error:String(e.message).slice(0,120)})}
 }
 return fallback(base,base.attempts.every(a=>a.outcome==='no-credential')?'no-credentials':'free-tier-exhausted-or-failed',deterministic);
}
function fallback(base,reason,deterministic){
 const d=deterministic||{verdict:'hold',confidence:0.3,rationale:'No model reasoning available.',disagreements:[]};
 return Object.freeze({...base,source:'deterministic-fallback',modelInvoked:false,fallbackReason:reason,queued:reason==='free-tier-exhausted-or-failed',...d});
}

/** Builder proposes, Skeptic challenges, Sentinel checks security. */
export async function runReasoningRound({input,deterministic,...opts}){
 const results={};
 for(const role of Object.keys(REASONING_ROLES))results[role]=await reasonAsRole({role,input,deterministic:deterministic?.[role],...opts});
 const vs=Object.values(results).map(r=>r.verdict);
 const disagreement=new Set(vs).size>1;
 return Object.freeze({results,disagreement,
  modelInvocations:Object.values(results).filter(r=>r.modelInvoked).length,
  aiReasoned:Object.values(results).every(r=>r.modelInvoked),
  verdicts:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,v.verdict]))});
}
