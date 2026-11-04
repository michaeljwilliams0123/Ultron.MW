(()=>{
'use strict';
const root=document.getElementById('hf-model-lab');
if(!root)return;
const status=document.getElementById('hf-lab-status');
const button=document.getElementById('hf-lab-refresh');
const workflows=document.getElementById('hf-lab-workflows');
const scores=document.getElementById('hf-lab-scores');
const evidence=document.getElementById('hf-lab-evidence');
const GH='https://github.com/michaeljwilliams0123/Ultron.MW';
let running=false;
const text=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=String(value);if(cls)el.className=cls;return el};
const clock=iso=>iso&&Number.isFinite(Date.parse(iso))?new Date(iso).toLocaleString():'unverified time';
const link=(caption,url)=>{const a=text('a',caption);if(typeof url==='string'&&url.startsWith(GH+'/')){a.href=url;a.target='_blank';a.rel='noopener noreferrer'}return a};
function render(data){
 workflows.replaceChildren();scores.replaceChildren();
 const arr=Array.isArray(data.workflows)?data.workflows:[];
 for(const run of arr){
  const card=document.createElement('article');
  const complete=run.state==='observed'&&run.status==='completed'&&run.conclusion==='success';
  const failed=run.state==='observed'&&run.status==='completed'&&run.conclusion!=='success';
  card.className='hf-run';card.dataset.state=complete?'ok':failed?'error':'unknown';
  card.append(text('h3',run.label||run.key||'Unverified workflow'));
  card.append(text('strong',run.state==='observed'?
   run.status==='completed'?String(run.conclusion||'unknown result'):String(run.status||'in progress')
   :run.state==='no-run'?'No observed run':'Unavailable'));
  card.append(text('p',run.state==='observed'?
   'Run '+run.runId+' · '+clock(run.startedAt)+' · '+String(run.headSha||'').slice(0,12):
   'GitHub API did not verify a recent run; do not infer a pass.'));
  card.append(link(run.runUrl?'Open verified run':'Open workflow',
   run.runUrl||run.workflowUrl));
  workflows.append(card);
 }
 if(!arr.length)workflows.append(text('p','Workflow evidence not available.'));
 const benchmark=data.benchmark;
 if(benchmark?.observation==='historical-evidence'&&Array.isArray(benchmark.models)){
  for(const model of benchmark.models){
   const tile=document.createElement('div');tile.className='hf-score';
   if(model.approvedUse==='noncommercial-evaluation-only')tile.dataset.restriction='research';
   tile.append(text('strong',String(model.passed)+' / '+String(benchmark.cases)));
   tile.append(text('span',model.label||model.key));
   scores.append(tile);
  }
  evidence.textContent='Historical run '+benchmark.runId+' · '+String(benchmark.sourceSha||'').slice(0,12)+
   ' · 16 synthetic cases. No production model promotion; 3B is research-only.';
 }else{
  evidence.textContent='Historical benchmark receipts unavailable.';
 }
 const c=data.cache||{};
 const problems=arr.filter(x=>x.state==='unavailable').length;
 status.dataset.state=c.state==='stale'||problems?'warning':'ok';
 status.textContent='Observed '+clock(c.observedAt||data.observedAt)+
  ' · cache '+String(c.state||'unknown')+
  (problems?' · '+problems+' workflow(s) unverified':'')+
  (c.reason?' · '+String(c.reason):'')+
  '. Success is not production acceptance.';
}
async function refresh(){
 if(running)return;
 running=true;button.disabled=true;status.textContent='Checking cached GitHub evaluation receipts…';
 try{
  const response=await fetch('/api/brain/hf-lab',{
   method:'GET',credentials:'same-origin',cache:'no-store',
   headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error([401,403].includes(response.status)?
   'Owner sign-in required':'Hatchable status '+response.status);
  const data=await response.json();
  if(data.schema!=='ultron.hf-lab.v1')throw Error('Invalid model-lab response');
  render(data);
 }catch(error){
  status.dataset.state='warning';
  status.textContent=String(error.message||'Unavailable')+
   '. Model evaluations and protected results were not inferred.';
 }finally{running=false;button.disabled=false}
}
button.addEventListener('click',refresh);
window.addEventListener('ultron:realtime-change',refresh);
refresh();
})();
