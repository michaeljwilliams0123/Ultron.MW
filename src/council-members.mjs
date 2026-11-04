/** Per-member identity + brain for the seven Ultron Council members.
 * Identity: its own GitHub App (slug, bot login, credential env names, memory
 * namespace). Brain: its own mandate and rule set that turns the same case
 * into a distinct verdict, plain-language reasons and concrete actions.
 * Rights: owner-equivalent (see council-app-identities.mjs).
 */
import {createSign} from 'node:crypto';
import {COUNCIL_APP_ROLES,authenticateCouncilAppActor,decideCouncilAction}
  from './council-app-identities.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const slugify=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'item';

export function councilMemberIdentity(role){
  if(!COUNCIL_APP_ROLES.includes(role))throw Error('council-role-invalid');
  const upper=role.toUpperCase();
  return Object.freeze({
    role,roleId:'ultron-'+role.toLowerCase(),
    appSlug:'ultron-mw-'+role.toLowerCase(),
    botLogin:'ultron-mw-'+role.toLowerCase()+'[bot]',
    credentialEnv:Object.freeze({
      appId:'COUNCIL_'+upper+'_APP_ID',
      privateKey:'COUNCIL_'+upper+'_APP_PRIVATE_KEY',
      installationId:'COUNCIL_'+upper+'_INSTALLATION_ID'
    }),
    memoryNamespace:'council/'+role.toLowerCase()
  });
}

const has=(text,words)=>words.some(w=>text.includes(w));
const act=(op,why,extra={})=>({op,why,...extra});

/** Each brain: mandate + assess(ctx) -> {verdict,confidence,headline,reasons,actions}.
 * ctx: {title,body,isPr,itemNumber,flags,governor:{conclusion,confidence,unknowns}}
 */
const BRAINS={
  Builder:{
    mandate:'Ship it: turn the request into a working change.',
    assess(c){
      const spec=has(c.text,['acceptance','expected','should','must','add ','fix ','implement']);
      const reasons=[spec?'The request states concrete behaviour to build.':'No concrete behaviour is stated; nothing to build against yet.'];
      const actions=[];
      if(spec&&!c.isPr)actions.push(act('branch.create','Start an implementation branch.',{branch:'ultron/council-builder-'+slugify(c.title)}));
      if(c.isPr)actions.push(act('pr.comment','Report build readiness on the exact head.'));
      return{verdict:spec&&!c.flags.security?'proceed':'hold',
        headline:spec?'Buildable as written.':'Needs a concrete spec.',reasons,actions};
    }
  },
  Skeptic:{
    mandate:'Break it: find the assumption that makes this wrong.',
    assess(c){
      const tests=has(c.text,['test','verify','regression','acceptance']);
      const reasons=[tests?'Verification is mentioned, so claims can be falsified.':'No test or verification criterion; success cannot be disproven.'];
      if(c.flags.multiFile)reasons.push('Multi-file scope multiplies unverified interactions.');
      if(c.flags.security)reasons.push('Security language raises the bar for counter-evidence.');
      const bad=!tests||c.flags.security;
      return{verdict:bad?'hold':'proceed',headline:bad?'Unproven; needs a falsifiable test.':'Claims are testable.',
        reasons,actions:[c.isPr?
          act(bad?'review.request-changes':'review.comment',bad?'Request a failing-then-passing test.':'Record that no counterexample was found.'):
          act('issue.comment','Post the strongest counterexample to be answered.')]};
    }
  },
  Steward:{
    mandate:'Guard authority, provenance and release gates.',
    assess(c){
      const protectedArea=has(c.text,['.github','workflow','secret','credential','token','permission','release']);
      const reasons=[protectedArea?'Touches protected areas (workflows, credentials or permissions).':'No protected area touched.'];
      if(c.flags.security)reasons.push('Security signal: owner sign-off is required.');
      const hold=c.flags.security;
      return{verdict:hold?'hold':'proceed',headline:hold?'Owner sign-off required.':'Within authority.',reasons,
        actions:[act('issue.label',protectedArea?'Label as governance-sensitive.':'Label as council-reviewed.',{labels:[protectedArea?'governance':'council-reviewed']})]};
    }
  },
  Predictor:{
    mandate:'Forecast outcomes and name what would change the call.',
    assess(c){
      const size=c.body.length>2000||c.flags.multiFile;
      const reasons=[size?'Large or multi-file change: higher chance of regression.':'Small change: low regression risk.'];
      if(c.governor.unknowns.length)reasons.push('Open unknowns: '+c.governor.unknowns.join(', ')+'.');
      return{verdict:size&&c.flags.security?'hold':'proceed',
        headline:size?'Moderate risk; watch CI.':'Low risk.',reasons,
        actions:[act('issue.comment','Publish forecast and the signals that would flip it.')]};
    }
  },
  Generator:{
    mandate:'Offer a better or cheaper alternative.',
    assess(c){
      const reasons=['Alternative to evaluate: smallest change that satisfies the request, behind a flag.'];
      if(c.flags.multiFile)reasons.push('Alternative: split into one PR per file group.');
      return{verdict:c.governor.conclusion,headline:'Alternative proposed.',reasons,
        actions:c.flags.multiFile?[act('issue.create','Open a follow-up issue for the split plan.',{title:'Split plan: '+c.title.slice(0,100)})]:[act('issue.comment','Post the alternative.')]};
    }
  },
  Sentinel:{
    mandate:'Watch reliability, drift and live operations.',
    assess(c){
      const reasons=[c.flags.infra?'Touches CI/deploy; run Verify before anything merges.':'No infrastructure impact detected.'];
      const hold=c.flags.security||(c.flags.infra&&c.isPr&&!c.sourceSha);
      return{verdict:hold?'hold':'proceed',headline:hold?'Alert: verify first.':'Operationally quiet.',reasons,
        actions:c.flags.infra||c.isPr?[act('actions.dispatch','Run Verify on main.',{workflow:'verify.yml',ref:'main'})]:[]};
    }
  },
  Companion:{
    mandate:'Keep the owner’s latest intent and priorities central.',
    assess(c){
      const reasons=[c.ownerMode?'Owner-initiated: execution outranks gatekeeping.':'Not owner-initiated; confirm intent before acting.'];
      return{verdict:c.ownerMode&&!c.flags.security?'proceed':'hold',
        headline:c.ownerMode?'Matches owner intent.':'Awaiting owner confirmation.',reasons,
        actions:[act('issue.comment','Restate the owner intent and next step in one line.')]};
    }
  }
};

export function assessAsMember(role,{title='',body='',isPr=false,itemNumber=0,sourceSha='',flags={},ownerMode=false,governorPosition}={}){
  if(!Object.hasOwn(BRAINS,role))throw Error('council-role-invalid');
  const brain=BRAINS[role];
  const ctx={title,body,isPr,itemNumber,sourceSha,flags,ownerMode,
    text:(title+'\n'+body).toLowerCase(),
    governor:{conclusion:governorPosition?.conclusion==='proceed'?'proceed':'hold',
      confidence:governorPosition?.confidence??0,unknowns:governorPosition?.unknowns??[]}};
  const r=brain.assess(ctx);
  return Object.freeze({identity:councilMemberIdentity(role),mandate:brain.mandate,
    verdict:r.verdict,confidence:Number(ctx.governor.confidence.toFixed(2)),
    headline:r.headline,reasons:Object.freeze(r.reasons),
    actions:Object.freeze(r.actions.map(a=>Object.freeze(a)))});
}

export function assessCouncil(ctx){
  const byRole=new Map((ctx.governorPositions||[]).map(p=>[p.individualId,p]));
  return COUNCIL_APP_ROLES.map(role=>assessAsMember(role,
    {...ctx,governorPosition:byRole.get('ultron-'+role.toLowerCase())}));
}

const b64u=b=>Buffer.from(b).toString('base64url');
export function appJwt({appId,privateKey,now=Math.floor(Date.now()/1000)}){
  const head=b64u(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const pay=b64u(JSON.stringify({iat:now-30,exp:now+540,iss:String(appId)}));
  const sig=createSign('RSA-SHA256').update(head+'.'+pay).sign(privateKey).toString('base64url');
  return head+'.'+pay+'.'+sig;
}

/** Member's own credentials from env; null when not provisioned. */
export function memberCredentials(role,env=process.env){
  const e=councilMemberIdentity(role).credentialEnv;
  const appId=env[e.appId],installationId=env[e.installationId];
  const privateKey=(env[e.privateKey]||'').replace(/\\n/g,'\n');
  return appId&&installationId&&privateKey?{appId,installationId,privateKey}:null;
}

export async function mintInstallationToken(creds,fetchImpl=fetch){
  const r=await fetchImpl('https://api.github.com/app/installations/'+creds.installationId+'/access_tokens',{
    method:'POST',headers:{authorization:'Bearer '+appJwt(creds),accept:'application/vnd.github+json','user-agent':'ultron-council'}});
  if(!r.ok)throw Error('council-token-mint-failed:'+r.status);
  return (await r.json()).token;
}

const api=(token,fetchImpl)=>async(method,path,body)=>{
  const r=await fetchImpl('https://api.github.com/repos/'+REPO+path,{method,
    headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'ultron-council','content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw Error('github-'+r.status+' '+method+' '+path);
  return r.status===204?null:r.json();
};

/** Execute one action as the member's own App identity, gated by policy. */
export async function executeMemberAction(actor,token,action,target,{fetchImpl=fetch,deps={}}={}){
  const decision=decideCouncilAction(actor,{operation:action.op,baseSha:actor.sourceSha,
    maxPaidCents:0,attempt:1,branch:action.branch,workflow:action.workflow,ref:action.ref,
    prAuthor:target.prAuthor||'unknown',
    externalIntentFingerprint:undefined,caseSha:undefined});
  if(!decision.allowed)return{op:action.op,status:'denied',reason:decision.reason};
  const call=api(token,fetchImpl),n=target.number,text=action.text||action.why;
  const signed='**'+actor.role+'** (`ultron-mw-'+actor.role.toLowerCase()+'`): ';
  switch(action.op){
    case 'issue.comment':case 'pr.comment':case 'review.comment':
      await call('POST','/issues/'+n+'/comments',{body:signed+text});break;
    case 'review.request-changes':
      await call('POST','/pulls/'+n+'/reviews',{event:'REQUEST_CHANGES',body:signed+text});break;
    case 'review.approve':
      await call('POST','/pulls/'+n+'/reviews',{event:'APPROVE',body:signed+text});break;
    case 'issue.label':
      await call('POST','/issues/'+n+'/labels',{labels:action.labels||[]});break;
    case 'issue.assign':
      await call('POST','/issues/'+n+'/assignees',{assignees:action.assignees||[]});break;
    case 'issue.close':case 'pr.close':
      await call('PATCH','/issues/'+n,{state:'closed'});break;
    case 'issue.create':
      await call('POST','/issues',{title:action.title||'Council follow-up',body:signed+text});break;
    case 'pr.merge':
      await call('PUT','/pulls/'+n+'/merge',{merge_method:'squash'});break;
    case 'branch.create':{
      const ref=await call('GET','/git/ref/heads/main');
      await call('POST','/git/refs',{ref:'refs/heads/'+action.branch,sha:ref.object.sha});break;}
    case 'branch.delete':
      await call('DELETE','/git/refs/heads/'+action.branch);break;
    case 'actions.dispatch':
      await call('POST','/actions/workflows/'+action.workflow+'/dispatches',{ref:action.ref||'main'});break;
    case 'computer.browser':{
      if(!deps.browser)return{op:action.op,status:'unconfigured',reason:'ULTRON_CLOUD_BROWSER_WS'};
      const {page}=action.signIn?await deps.browser.signIn(action.url):{page:await deps.browser.goto(action.url)};
      const out=[];
      for(const s of action.steps||[])out.push(await deps.browser.act(page,s));
      return{op:action.op,status:'done',result:out};}
    case 'computer.desktop':{
      if(!deps.desktop)return{op:action.op,status:'unconfigured',reason:'ULTRON_CLOUD_DESKTOP_URL'};
      const out=[];
      for(const s of action.steps||[])out.push(await deps.desktop[s.verb](...(s.args||[])));
      return{op:action.op,status:'done',result:out};}
    default:return{op:action.op,status:'unsupported'};
  }
  return{op:action.op,status:'done'};
}

/** Authenticate one member from its own token, then run its actions. */
export async function runMemberActions({role,sourceSha,token,assessment,target,fetchImpl=fetch,profile='owner-equivalent',deps={}}){
  const actor=await authenticateCouncilAppActor({role,sourceSha,installationToken:token,profile,
    githubProbe:async()=>{
      const r=await fetchImpl('https://api.github.com/installation/repositories',{headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','user-agent':'ultron-council'}});
      if(!r.ok)throw Error('council-probe-failed');
      const j=await r.json();
      const i=await (await fetchImpl('https://api.github.com/repos/'+REPO+'/installation',{headers:{authorization:'Bearer '+appJwtFromEnv(role),accept:'application/vnd.github+json','user-agent':'ultron-council'}})).json();
      return{source:'github-installations-api',app_id:i.app_id,id:i.id,app_slug:i.app_slug,
        suspended_at:i.suspended_at,permissions:i.permissions,
        repositories:j.repositories.map(x=>x.full_name)};
    }});
  const results=[];
  for(const action of assessment.actions){
    try{results.push(await executeMemberAction(actor,token,action,target,{fetchImpl,deps}));}
    catch(e){results.push({op:action.op,status:'error',reason:String(e.message).slice(0,200)});}
  }
  return results;
}
function appJwtFromEnv(role){return appJwt(memberCredentials(role));}
