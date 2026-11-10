'use strict';
const statusNode=document.getElementById('status');
const container=document.getElementById('connections');
const button=document.getElementById('refresh');
function item(label,value,description,positive=false,target=container){
 const article=document.createElement('article');
 const heading=document.createElement('h3');
 heading.textContent=label;
 const state=document.createElement('p');
 state.className='state '+(positive?'ok':'pending');
 state.textContent=value;
 const detail=document.createElement('p');
 detail.className='muted';
 detail.textContent=description;
 article.append(heading,state,detail);
 target.append(article);
}
function status(value){statusNode.textContent=value;}
async function refresh(){
 button.disabled=true;
 container.replaceChildren();
 status('Checking owner-only connection status…');
 try{
  const response=await fetch('/api/brain/connectors',{method:'GET',
   credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.schema!=='ultron.connector-readiness.v1'||!data.ownerAuthenticated)
   throw Error(response.status===401?'Sign in to Hatchable as the owner.':
    'Owner authorization or connector readback unavailable.');
  status('Owner session authenticated · '+data.repository.name+' · no write attempted');
  item('Hatchable owner','Authenticated','Session is platform-verified.',true);
  item('GitHub OAuth (dedicated Ultron account)',data.githubOauth?.state||'setup-required',
   data.githubOauth?.state==='identity-and-repository-read-verified'
    ?'Verified '+data.githubOauth.actor+' on '+data.repository.name+'; provider push flag: '+String(data.githubOauth.providerPushFlag)+'. Writes remain owner-gated.'
    :'Connect the dedicated Ultron GitHub account from Hatchable Setup; readback does not approve writes.',
   data.githubOauth?.state==='identity-and-repository-read-verified'&&
    data.githubOauth?.readCoverage==='complete');
  if(data.githubOauth?.state==='identity-and-repository-read-verified'){
   for(const [label,key] of [
    ['GitHub issues','issues'],['GitHub pull requests','pullRequests'],
    ['GitHub Actions','actions']]){
    const observed=data.githubOauth.readCapabilities?.[key]===true;
    item(label,observed?'Authenticated GET verified':'GET unavailable',
     'Independent provider read test; no mutation attempted.',observed);
   }
  }
  item('GitHub App',data.githubApp.state,
   'Organization installation and scoped GitHub mutation still require provider proof.',
   data.githubApp.installationVerified===true);
  item('GitHub issue token',data.githubIssueToken.state,
   'Optional legacy issue credential; not a substitute for the scoped App.');
  item('GitLab read',data.gitlab.read.state,
   'Authenticated read-only API probe.',data.gitlab.read.state==='authenticated-read');
  item('GitLab write-scoped OAuth',data.gitlab.writeScopeReadProbe.state,
   'Read authentication only; a GitLab write has not been approved or verified.',
   data.gitlab.writeScopeReadProbe.state==='authenticated-read');
  item('Mahoraga App',data.mahoragaApp.state,
   'Separate installation. Never assume permission on the Ultron organization.');
  item('Microsoft Graph',data.graph.state,
   'Requires separate delegated authorization for a bounded workbook.');
  item('Email PIN','Hatchable-managed',
   'Gmail access in ChatGPT is not transferred into this project.',true);
 }catch(error){status(String(error?.message||'Connector readback unavailable.'))}
 finally{button.disabled=false;}
}
const testButton=document.getElementById('run-tests');
const testStatus=document.getElementById('test-status');
const testResults=document.getElementById('test-results');
async function runExtended(){
 testButton.disabled=true;
 testResults.replaceChildren();
 testStatus.textContent='Running deterministic regressions and read-only cloud checks…';
 const fetchJson=async path=>{
  const response=await fetch(path,{method:'GET',credentials:'same-origin',
   cache:'no-store',headers:{Accept:'application/json'}});
  const result=await response.json().catch(()=>({}));
  return {response,result};
 };
 try{
  const checks=await Promise.allSettled([
   fetchJson('/api/brain/connector-regression'),
   fetchJson('/api/brain/connectivity')
  ]);
  if(checks[0].status==='fulfilled'){
   const {response,result}=checks[0].value;
   const valid=result.schema==='ultron.connector-regression.v1';
   const success=valid&&response.ok&&result.passed===result.tested&&
    result.failed===0&&result.providerWrites===0;
   item('Auth regression tests',valid?
    result.passed+'/'+result.tested+' passed':'Unavailable',
    'Deterministic mocks: wrong identity, repository, malformed responses, revoked OAuth and denied scopes. Not a live write.',
    success,testResults);
  }else item('Auth regression tests','Unavailable',
   'Could not run the deterministic suite.',false,testResults);
  if(checks[1].status==='fulfilled'){
   const {response,result}=checks[1].value;
   if(!response.ok||result.schema!=='ultron.connectivity.v1')
    throw Error('Cloud connectivity response unavailable');
   const mainVerified=result.github?.state==='observed';
   const sha=mainVerified?result.github.mainSha:null;
   item('Live GitHub main',mainVerified?sha.slice(0,12):'Unverified',
    'Public GitHub main ref; independent of unconnected OAuth.',mainVerified,testResults);
   const onExactHead=result.ci?.state==='observed'&&
    result.ci?.sourceSha===sha&&mainVerified;
   item('Exact-main CI',onExactHead?
    (result.ci.conclusion||result.ci.status||'Running'):'Not verified',
    'Latest observed source CI matches the sampled main SHA only when indicated.',
    onExactHead&&result.ci.conclusion==='success',testResults);
   item('Open PR inventory',result.pullRequests?.state==='observed'?
    String(result.pullRequests.sampled)+' sampled':'Unavailable',
    'Read-only, bounded GitHub open-pull-request sample.',
    result.pullRequests?.state==='observed',testResults);
   item('Durable task queue',result.queue?.state||'Unavailable',
    'PostgreSQL task status sampled without modifying the queue.',
    result.queue?.state==='observed',testResults);
  }else item('Live source/queue checks','Unavailable',
   'Source or database readback could not be completed.',false,testResults);
  testStatus.textContent='Read-only checks complete. Green results are observations, not approval to execute.';
 }catch(error){
  testStatus.textContent=String(error?.message||'Extended verification unavailable.');
 }finally{testButton.disabled=false;}
}
button.addEventListener('click',refresh);
testButton.addEventListener('click',runExtended);
refresh();