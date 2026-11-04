/** Cloud-only computer control for the owner. No local browser, no local
 * binding, no per-plan origin allowlist: it acts as the owner on any site or
 * desktop, using credentials saved in an encrypted vault so sign-in is instant.
 *
 *  - Browser: a remote Chromium reached over CDP (ULTRON_CLOUD_BROWSER_WS,
 *    e.g. a Cloudflare Browser Run / Browserbase websocket URL).
 *  - Desktop: a remote desktop agent (ULTRON_CLOUD_DESKTOP_URL + _TOKEN) that
 *    exposes screenshot/click/type/key/scroll over HTTPS (a cloud VM).
 *  - Vault: AES-256-GCM; key in ULTRON_VAULT_KEY (32 bytes, base64). Entries
 *    are stored by the caller's persistence (Hatchable DB) as opaque blobs.
 */
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

const keyOf=k=>{
  const b=Buffer.from(String(k||''),'base64');
  if(b.length!==32)throw Error('vault-key-invalid');
  return b;
};
export function sealCredential(value,vaultKey){
  const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',keyOf(vaultKey),iv);
  const ct=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);
  return Buffer.concat([iv,c.getAuthTag(),ct]).toString('base64');
}
export function openCredential(blob,vaultKey){
  const b=Buffer.from(String(blob),'base64');
  if(b.length<29)throw Error('vault-blob-invalid');
  const d=createDecipheriv('aes-256-gcm',keyOf(vaultKey),b.subarray(0,12));
  d.setAuthTag(b.subarray(12,28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8'));
}

/** Vault over any async key/value store {get,set,list,delete}. Secrets are
 * never returned by list(); only open() decrypts, server-side. */
export function createCredentialVault({store,vaultKey}){
  keyOf(vaultKey);
  const id=site=>{
    const h=new URL(/^https?:/.test(site)?site:'https://'+site).hostname.toLowerCase();
    if(!h)throw Error('vault-site-invalid');
    return h;
  };
  return {
    async save(site,secret){await store.set('cred:'+id(site),sealCredential(secret,vaultKey));return {site:id(site),saved:true};},
    async open(site){const b=await store.get('cred:'+id(site));return b?openCredential(b,vaultKey):null;},
    async remove(site){await store.delete('cred:'+id(site));},
    async list(){return (await store.list('cred:')).map(k=>k.slice(5));}
  };
}

const LOGIN_FIELDS={
  user:'input[type=email],input[name=email],input[name=username],input[name=login],input#username,input#email,input[type=text]',
  pass:'input[type=password]',
  submit:'button[type=submit],input[type=submit]'
};

/** Remote browser session. `playwright` is injectable (tests, or the cloud
 * runtime's own module). Sessions persist via storageState saved in the vault,
 * so repeat visits skip login. */
export async function openCloudBrowser({vault,env=process.env,playwright}={}){
  let ws=env.ULTRON_CLOUD_BROWSER_WS,headers;
  if(!ws&&env.CLOUDFLARE_API_TOKEN&&env.CLOUDFLARE_ACCOUNT_ID){
    // Cloudflare Browser Run sessions are short-lived, so mint one per run.
    headers={authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN};
    const r=await (env.fetch||fetch)(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/devtools/browser?keep_alive=600000`,{method:'POST',headers});
    if(!r.ok)throw Error('cloud-browser-session-'+r.status);
    ws=(await r.json()).webSocketDebuggerUrl;
  }
  if(!ws)throw Error('cloud-browser-unconfigured');
  const pw=playwright||await import('playwright');
  const browser=await pw.chromium.connectOverCDP(ws,headers?{headers}:undefined);
  const contexts=new Map();
  async function ctxFor(site){
    const host=new URL(site).hostname;
    if(contexts.has(host))return contexts.get(host);
    const saved=vault?await vault.open(host):null;
    const context=browser.contexts()[0]&&!saved?browser.contexts()[0]:
      await browser.newContext(saved?.storageState?{storageState:saved.storageState}:{});
    contexts.set(host,context);
    return context;
  }
  const api={
    async goto(url){
      const context=await ctxFor(url);
      const page=context.pages()[0]||await context.newPage();
      await page.goto(url,{waitUntil:'domcontentloaded'});
      return page;
    },
    /** Use saved credentials: replays session if valid, else fills the form. */
    async signIn(url){
      const page=await api.goto(url);
      const host=new URL(url).hostname;
      const cred=vault?await vault.open(host):null;
      if(!cred?.username||!cred?.password)return {page,signedIn:false,reason:'no-saved-credentials'};
      const pass=page.locator(LOGIN_FIELDS.pass).first();
      if(!await pass.count())return {page,signedIn:true,reason:'session-reused'};
      await page.locator(LOGIN_FIELDS.user).first().fill(cred.username);
      if(await pass.isVisible())await pass.fill(cred.password);
      else{await page.keyboard.press('Enter');await pass.waitFor({timeout:8000}).catch(()=>{});await pass.fill(cred.password);}
      await Promise.all([page.waitForLoadState('domcontentloaded').catch(()=>{}),
        page.locator(LOGIN_FIELDS.submit).first().click().catch(()=>page.keyboard.press('Enter'))]);
      if(vault)await vault.save(host,{...cred,storageState:await page.context().storageState()});
      return {page,signedIn:true,reason:'form-login'};
    },
    async act(page,step){
      switch(step.action){
        case 'click':await page.locator(step.selector).first().click();break;
        case 'type':await page.locator(step.selector).first().fill(step.value);break;
        case 'key':await page.keyboard.press(step.key);break;
        case 'scroll':await page.mouse.wheel(0,step.pixels||600);break;
        case 'text':return page.innerText(step.selector||'body');
        case 'goto':await page.goto(step.url,{waitUntil:'domcontentloaded'});break;
        default:throw Error('cloud-browser-action-unknown');
      }
      return {url:page.url(),title:await page.title()};
    },
    async close(){await browser.close();}
  };
  return api;
}

/** Remote desktop (cloud VM) over HTTPS. Same verbs a human uses. */
export function createCloudDesktop({env=process.env,fetchImpl=fetch}={}){
  const base=env.ULTRON_CLOUD_DESKTOP_URL,token=env.ULTRON_CLOUD_DESKTOP_TOKEN;
  if(!base||!token)throw Error('cloud-desktop-unconfigured');
  if(new URL(base).protocol!=='https:')throw Error('cloud-desktop-must-be-https');
  const call=async(path,body)=>{
    const r=await fetchImpl(base.replace(/\/$/,'')+path,{method:'POST',
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify(body||{})});
    if(!r.ok)throw Error('cloud-desktop-'+r.status);
    return r.json();
  };
  return {
    screenshot:()=>call('/screenshot'),
    click:(x,y,button='left')=>call('/click',{x,y,button}),
    doubleClick:(x,y)=>call('/double_click',{x,y}),
    type:text=>call('/type',{text}),
    key:keys=>call('/key',{keys}),
    scroll:(x,y,dy)=>call('/scroll',{x,y,dy}),
    drag:(from,to)=>call('/drag',{from,to}),
    launch:app=>call('/launch',{app})
  };
}
