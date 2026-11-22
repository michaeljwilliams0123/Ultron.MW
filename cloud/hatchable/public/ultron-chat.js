(()=>{'use strict';
if(!document.body.classList.contains('u-council'))return;
const $=id=>document.getElementById(id);
const el=(tag,cls,txt)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(txt!==undefined)x.textContent=txt;return x;};
const modal=(name,title)=>{
 const d=el('dialog','ultron-chat-dialog');d.id='ultron-'+name+'-dialog';d.setAttribute('aria-label',title);
 const bar=el('header','ultron-dialog-top');const heading=el('h2','',title),close=el('button','ultron-dialog-close','Close');
 close.type='button';close.addEventListener('click',()=>d.close());
 bar.append(heading,close);const content=el('section','ultron-dialog-content');d.append(bar,content);document.body.append(d);
 d.addEventListener('click',e=>{if(e.target===d)d.close();});return {dialog:d,content,heading};
};
const open=d=>{if(!d.open)d.showModal();};
const activity=modal('activity','Activity');
const settings=modal('settings','Capabilities & settings');
const action=modal('action','Ultron action');
const activePanel=document.querySelector('.activity-panel');
if(activePanel)activity.content.append(activePanel);
const links=el('div','ultron-settings-links');
for(const [title,href] of [
 ['Connections','/connectors.html'],['Owner passkeys','/passkey-owner.html'],
 ['Cloud controls','/index.html?controls=1'],['Monitoring','/monitoring.html'],['Repair operations','/repair-operations.html'],
 ['Workspaces & learning','/workspace.html'],['Local workbooks','/local-workbooks.html'],
 ['GitHub Actions','https://github.com/michaeljwilliams0123/Ultron.MW/actions']
]){const a=el('a','',title);a.href=href;if(href.startsWith('https:')){a.target='_blank';a.rel='noopener noreferrer';}links.append(a);}
settings.content.append(links);
const issue=document.querySelector('.u-issue-details'),desk=$('owner-action-desk');
if(issue)settings.content.append(issue);
if(desk)settings.content.append(desk);
const heading=$('room-title');if(heading)heading.textContent='Ultron';
const intro=document.querySelector('.conversation-head p:not(.overline)');
if(intro)intro.textContent='Ask, authorize, execute, verify. One conversation, all your capabilities.';
const overline=document.querySelector('.conversation-head .overline');if(overline)overline.textContent='YOUR OPERATIONAL ASSISTANT';
const top=document.querySelector('.conversation-head');
const bar=el('nav','ultron-chat-toolbar');bar.setAttribute('aria-label','Chat actions');
const makeButton=(label,handler)=>{
 const b=el('button','ultron-chat-chip',label);b.type='button';b.addEventListener('click',handler);bar.append(b);return b;
};
makeButton('Sign canary',()=>askPr('canary'));
makeButton('Squash merge',()=>askPr('merge'));
makeButton('Connect',()=>showAction({kind:'connection',provider:'github',requiresOwnerAuthorization:true}));
makeButton('Release status',()=>showAction({kind:'release',requiresOwnerAuthorization:false}));
if(top)top.insertAdjacentElement('afterend',bar);
const nav=el('nav','ultron-chat-tabs');nav.setAttribute('aria-label','Workspace sections');
const navButton=(label,handler)=>{
 const b=el('button','',label);b.type='button';b.addEventListener('click',handler);nav.append(b);return b;
};
navButton('Chat',()=>$('composer-body')?.focus());
navButton('Activity',()=>open(activity.dialog));
navButton('Settings',()=>open(settings.dialog));
document.querySelector('.u-header')?.append(nav);
const hint=document.querySelector('.u-header-help');if(hint)hint.hidden=true;
const body=$('composer-body');if(body){
 body.placeholder='Ask Ultron to review, connect, sign, merge, investigate or build…';
 body.setAttribute('aria-label','Message Ultron');
}
const lead=document.querySelector('.composer-topline span:first-child');if(lead)lead.textContent='Talk to Ultron';
const actionText=(label,txt)=>{const p=el('p','ultron-action-copy',txt);action.content.append(p);};
const link=(name,href,asButton=false)=>{
 const a=el('a',asButton?'ultron-primary-link':'ultron-inline-link',name);a.href=href;
 if(href.startsWith('https:')){a.target='_blank';a.rel='noopener noreferrer';}
 action.content.append(a);return a;
};
const frame=(src,title)=>{
 const iframe=el('iframe','ultron-action-frame');iframe.title=title;iframe.src=src;
 iframe.setAttribute('allow','publickey-credentials-get');iframe.referrerPolicy='same-origin';
 action.content.append(iframe);
};
const info=(key,value)=>{const row=el('div','ultron-proof-row');row.append(el('span','',key),el('strong','',String(value)));action.content.append(row);};
const statusMessage=message=>{const p=el('p','ultron-action-info',message);p.setAttribute('role','status');action.content.append(p);return p;};
const validPr=n=>Number.isSafeInteger(Number(n))&&Number(n)>0&&Number(n)<10000000;
function askPr(kind){
 action.heading.textContent=kind==='merge'?'Squash merge a PR':'Sign a PR comment canary';
 action.content.replaceChildren();
 actionText('',kind==='merge'?'Inspect the exact pull request and checks before selecting a signed merge route.':'Open the existing owner-signed comment canary without leaving this conversation.');
 const label=el('label','ultron-pr-label','Pull request number');const input=el('input','ultron-pr-input');
 input.type='number';input.min='1';input.max='9999999';input.placeholder='e.g. 516';input.setAttribute('inputmode','numeric');
 label.append(input);action.content.append(label);
 const go=el('button','ultron-action-run','Continue');go.type='button';
 go.addEventListener('click',()=>{const pr=Number(input.value);if(!validPr(pr))return input.setCustomValidity('Enter a valid PR number'),input.reportValidity();input.setCustomValidity('');void showAction({kind,pr,requiresOwnerAuthorization:true});});
 action.content.append(go);open(action.dialog);input.focus();
}
async function showAction(intent){
 if(!intent)return;
 action.content.replaceChildren();open(action.dialog);
 if(intent.kind==='canary'){
  action.heading.textContent='Sign comment canary · PR #'+intent.pr;
  actionText('', 'One scoped owner authorization. The existing canary verifies the target, uses your enrolled passkey, then independently reads back the GitHub comment.');
  const href='/github-pr-comment-canary.html?pr='+encodeURIComponent(intent.pr);
  link('Open signing full screen',href);
  frame(href,'Owner-signed GitHub PR comment canary');
  return;
 }
 if(intent.kind==='connection'){
  action.heading.textContent='Connect · '+intent.provider;
  actionText('','Connect providers through their existing authenticated setup. Ultron must verify the resulting identity before permitting writes.');
  frame('/connectors.html','Ultron provider connections');
  link('Open Hatchable connection setup','https://hatchable.com/console/projects/ultron-mw-cloud');
  return;
 }
 if(intent.kind==='release'){
  action.heading.textContent='Release evidence';
  const loading=statusMessage('Reading live release state…');
  try{
   const r=await fetch('/api/brain/release-proof',{credentials:'same-origin',cache:'no-store'});
   if(!r.ok)throw Error('HTTP '+r.status);
   const data=await r.json();loading.remove();
   info('Release verified',data.verified===true?'Yes':'Not yet');
   info('Status',data.status||'Unknown');
   if(data.commitSha||data.sourceSha)info('Source',String(data.commitSha||data.sourceSha).slice(0,12));
   if(data.driftDetails){
    info('CI verified',data.driftDetails.ciVerified?'Yes':'No');
    info('Council 7/7',data.driftDetails.councilVerified?'Yes':'No');
    info('Signed receipt',data.driftDetails.deploymentReceiptRecorded?'Recorded':'Missing');
    info('Live manifest readback',data.driftDetails.independentManifestReadback?'Verified':'Not yet');
    if(Array.isArray(data.driftDetails.missingGates)&&data.driftDetails.missingGates.length)
     info('Missing gates',data.driftDetails.missingGates.join(', '));
   }
   if(data.verified!==true)statusMessage('This is not release acceptance. Ultron will preserve the hold until independent evidence passes.');
  }catch{loading.textContent='Release proof currently unavailable. No deployment action was attempted.'}
  return;
 }
 if(intent.kind==='merge'){
  action.heading.textContent='Squash merge · PR #'+intent.pr;
  const loading=statusMessage('Checking the live GitHub pull request…');
  try{
   const r=await fetch('/api/brain/chat-pr?pr='+encodeURIComponent(intent.pr),{credentials:'same-origin',cache:'no-store'});
   const data=await r.json();
   if(!r.ok||!data.ok)throw Error(data.error||'PR unavailable');
   loading.remove();
   info('PR',data.number+' · '+data.title);
   info('State',data.merged?'Already merged':data.state+(data.draft?' (draft)':''));
   info('Mergeability',data.mergeable===true?'Mergeable':data.mergeable===false?'Conflict or blocked':'Not yet determined');
   if(data.headSha)info('Head',data.headSha.slice(0,12));
   link('Review exact PR on GitHub',data.url,true);
   if(!data.merged&&data.state==='open'&&!data.draft&&navigator.credentials?.get){
    const pkRes=await fetch('/api/brain/owner-passkeys',{credentials:'same-origin',cache:'no-store'});
    const pkData=await pkRes.json().catch(()=>({}));
    const creds=Array.isArray(pkData?.credentials)?pkData.credentials:[];
    if(creds.length){
     const select=el('select','ultron-pr-input');
     for(const c of creds){const o=el('option','',String(c.label||'Owner passkey').slice(0,64));o.value=c.credentialId;select.append(o);}
     const label=el('label','ultron-pr-label','Owner passkey');label.append(select);action.content.append(label);
     const execBtn=el('button','ultron-action-run','Authorize & Squash Merge (Passkey)');execBtn.type='button';
     const execStatus=statusMessage('Requires one device passkey confirmation. Posts verified receipt directly to chat.');
     execBtn.addEventListener('click',async()=>{
      execBtn.disabled=true;execStatus.textContent='Preparing passkey challenge…';
      try{
       const room=new URLSearchParams(location.search).get('room')||'owner-main';
       const prepRes=await fetch('/api/brain/chat-execute',{method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({operation:'pr.merge',mode:'prepare',pullRequest:data.number,room,credentialId:select.value})});
       const prep=await prepRes.json();
       if(!prepRes.ok||!prep.ok)throw Error(prep.reason||'Prepare failed');
       const dec=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),x=>x.charCodeAt(0));
       const enc=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
       const assertion=await navigator.credentials.get({publicKey:{
        challenge:dec(prep.challenge),rpId:prep.rpId,
        allowCredentials:[{type:'public-key',id:dec(prep.credentialId)}],
        userVerification:'required',timeout:120000
       }});
       if(!assertion)throw Error('Passkey cancelled');
       execStatus.textContent='Executing squash merge and verifying receipt…';
       const proof={grantId:prep.grantId,credentialId:enc(assertion.rawId),
        authenticatorData:enc(assertion.response.authenticatorData),
        clientDataJSON:enc(assertion.response.clientDataJSON),
        signature:enc(assertion.response.signature)};
       const runRes=await fetch('/api/brain/chat-execute',{method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({operation:'pr.merge',mode:'execute',prepared:prep.prepared,proof})});
       const out=await runRes.json();
       if(!runRes.ok||!out.ok)throw Error(out.reason||'Merge held ('+(out.status||'unknown')+')');
       execStatus.textContent='Verified squash merge completed: '+String(out.receipt?.details?.mergeCommitSha||'').slice(0,12)+'. Receipt posted to chat.';
       $('refresh')?.click();
      }catch(e){execStatus.textContent='Execution stopped: '+String(e.message||e);execBtn.disabled=false;}
     });
     action.content.append(execBtn);
    }
   }
   const compose=el('button','ultron-secondary-link','Discuss this merge with Ultron');
   compose.type='button';compose.addEventListener('click',()=>{
    action.dialog.close();if(body){body.value='Verify every required check and prepare an authorized squash merge for PR #'+intent.pr+'. Return exact evidence and any owner signing step.';body.dispatchEvent(new Event('input',{bubbles:true}));body.focus();}
   });action.content.append(compose);
  }catch{loading.textContent='Live PR verification is unavailable. No merge action was attempted.';}
 }
}
const voice=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;
if(voice&&body){
 const b=el('button','ultron-voice-button','Speak');b.type='button';b.setAttribute('aria-label','Dictate to Ultron');
 let recording=false;let recognition=null;
 b.addEventListener('click',()=>{
  if(recording){recognition?.stop();return;}
  recognition=new voice();recognition.lang=document.documentElement.lang||'en-US';recognition.interimResults=false;recognition.maxAlternatives=1;
  recognition.onresult=e=>{const spoken=e.results?.[0]?.[0]?.transcript||'';if(spoken){body.value=(body.value.trim()+' '+spoken).trim();body.dispatchEvent(new Event('input',{bubbles:true}));body.focus();}};
  recognition.onend=()=>{recording=false;b.textContent='Speak';b.removeAttribute('aria-pressed');};
  recognition.onerror=()=>{recording=false;b.textContent='Speak';b.removeAttribute('aria-pressed');};
  try{recognition.start();recording=true;b.textContent='Stop';b.setAttribute('aria-pressed','true');}catch{}
 });
 document.querySelector('.composer-actions')?.prepend(b);
}
const send=$('send');
if(send&&body){
 const route=async message=>{
  let parse=null;try{({parseUltronIntent:parse}=await import('/ultron-intent.mjs'));}catch{return;}
  const intent=parse(message);
  if(intent)void showAction(intent); // UI guidance only. Existing Council Room handles durable send.
 };
 send.addEventListener('click',()=>{void route(body.value);},{capture:true});
 body.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')void route(body.value);},{capture:true});
}
document.body.classList.add('ultron-chat-ready');
})();
