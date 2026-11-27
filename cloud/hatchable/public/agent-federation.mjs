// Static federation exploration. No connector, execution, storage or network authority.
export const agentCatalog=Object.freeze([
 ['ultron','Hatchable','orchestration','Executive and task authority','Existing runtime; federation adapter pending'],
 ['chatgpt','ChatGPT','reasoning','Strategy and independent review','Shared Drive verified; inbound wake-up pending'],
 ['gemini','Gemini','research','Research and analysis','Email and Drive canary observed; runtime adapter pending'],
 ['cloudflare-sentinel','Cloudflare','event-delivery','Signed event delivery and monitoring','Proposed; not provisioned'],
 ['github-engineer','GitHub','engineering','Bounded engineering and CI','Existing workflows; federation adapter pending'],
 ['reef','Ultron / GitHub','verification','Independent evidence validation','Existing evaluator; federation adapter pending'],
 ['mahoraga','Mahoraga','recovery','Recovery and adaptation','Existing runtime; federation adapter pending'],
 ['local-technician','Local host','local-execution','Authorized local tooling','Proposed federation adapter']
].map(([id,runtime,capability,role,evidence])=>Object.freeze({id,runtime,capability,role,evidence,dispatchEnabled:false})));
export function previewRoute(request){
 const deny=reason=>({state:'denied',reason,agentId:null,dispatchAllowed:false,paidCeilingCents:0});
 if(!request||typeof request!=='object'||request.mode!=='preview')return deny('Preview mode only; live dispatch is disabled.');
 if(request.budgetCents!==0)return deny('Explicit zero-cent budget required.');
 const agent=agentCatalog.find(a=>a.capability===request.capability);
 if(!agent)return deny('Unknown capability.');
 return {state:'preview-only',reason:'Proposed route only; no task created or provider called.',agentId:agent.id,dispatchAllowed:false,paidCeilingCents:0};
}
if(typeof document!=='undefined'){
 const select=document.getElementById('capability'),cards=document.getElementById('agents'),result=document.getElementById('preview-result'),form=document.getElementById('preview-form');
 for(const agent of agentCatalog){
  const option=document.createElement('option');option.value=agent.capability;option.textContent=agent.capability;select.append(option);
  const card=document.createElement('article');const title=document.createElement('h3');title.textContent=agent.id+' / '+agent.runtime;const role=document.createElement('p');role.textContent=agent.role;const evidence=document.createElement('p');evidence.textContent=agent.evidence;const state=document.createElement('strong');state.textContent='Dispatch disabled';card.append(title,role,evidence,state);cards.append(card);
 }
 form.addEventListener('submit',event=>{event.preventDefault();const preview=previewRoute({capability:select.value,mode:'preview',budgetCents:0});result.textContent=preview.agentId?preview.agentId+' — '+preview.reason:preview.reason;});
}
