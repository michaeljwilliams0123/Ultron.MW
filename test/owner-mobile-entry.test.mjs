import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const root=new URL('../cloud/hatchable/public/',import.meta.url);
const read=async file=>readFile(new URL(file,root),'utf8');

test('mobile owner entry has iPhone viewport, large touch targets, and shared sign-in',async()=>{
 const html=await read('owner-mobile.html');
 assert.match(html,/<meta name="viewport" content="width=device-width,initial-scale=1/);
 assert.match(html,/data-sign-in-card/);
 assert.match(html,/min-height:\s*48px/);
 assert.match(html,/href="\.\/passkey-owner\.html"/);
 assert.match(html,/href="https:\/\/github\.com\/settings\/security"/);
 assert.match(html,/href="https:\/\/support\.apple\.com\/guide\/iphone\//);
 assert.ok(html.indexOf('src="./sign-in.js"')<html.indexOf('src="./owner-mobile.js"'));
 assert.match(html,/C04.+requires.+separate.+owner.+grant/is);
});

async function start({signedIn=false,owner=true,pr='447',state='idle'}={}){
 const js=await read('owner-mobile.js');
 const ids=['session-state','pr-state','canary-link','device-state'];
 const dom=Object.fromEntries(ids.map(id=>[id,{textContent:'',href:'',hidden:false}]));
 const calls=[],mounts=[];
 const fetch=async(path,opts={})=>{
  calls.push({path,method:opts.method??'GET'});
  if(path==='/api/brain/session')
   return {status:signedIn?(owner?200:403):401,ok:signedIn&&owner,json:async()=>signedIn?{authenticated:true,owner:owner?'michaeljwilliams0123':'another-owner'}:{error:'login_required'}};
  if(path.startsWith('/api/brain/github-pr-comment-canary-status?pr='))
   return {status:200,ok:true,json:async()=>({state,pullRequest:Number(pr)})};
  throw Error('unexpected URL '+path);
 };
 runInNewContext(js,{document:{getElementById:id=>dom[id]},fetch,
  URLSearchParams,location:{search:'?pr='+pr,pathname:'/owner-mobile.html'},
  window:{UltronSignIn:{mount:async()=>mounts.push('login')}}});
 await new Promise(resolve=>setImmediate(resolve));
 return{dom,calls,mounts};
}

test('unsigned visitor only requests session and cannot expose attempt status',async()=>{
 const x=await start();
 assert.deepEqual(x.calls.map(c=>c.path),['/api/brain/session']);
 assert.match(x.dom['session-state'].textContent,/sign in/i);
 assert.ok(x.mounts.length>0);
});

test('signed-in owner gets read-only durable status and target deep link',async()=>{
 const x=await start({signedIn:true});
 assert.deepEqual(x.calls.map(c=>c.method),['GET','GET']);
 assert.equal(x.dom['canary-link'].href,'./github-pr-comment-canary.html?pr=447');
 assert.match(x.dom['pr-state'].textContent,/idle/i);
});

test('mobile landing cannot submit or collect grants, credentials, or cookies',async()=>{
 const html=await read('owner-mobile.html'),js=await read('owner-mobile.js');
 assert.doesNotMatch(js,/method:\s*['"]POST['"]|localStorage|sessionStorage|document\.cookie|navigator\.credentials\.create/);
 assert.doesNotMatch(html,/<input[^>]+(password|secret|private|signature|envelope)/i);
 assert.doesNotMatch(js,/ULTRON_GITHUB_APP_PRIVATE_KEY|owner-private\.jwk/);
});
