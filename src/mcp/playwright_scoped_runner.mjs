/**
 * Owner-approved, one-action Playwright session runner.
 * 
 * This module is intentionally NOT registered as an MCP tool. A trusted
 * caller must bind authorizeAction to its signed, operation-specific grant,
 * and configure a trusted isolated browser egress perimeter. The returned
 * `success` only attests to a dispatched UI action, NOT a persisted remote
 * effect; external write completion requires an independent provider readback.
 */
import { installNetworkPolicy } from '../computer/playwright-driver.mjs';

const ROLES = new Set([
  'button','link','checkbox','radio','switch','menuitem','menuitemcheckbox',
  'menuitemradio','tab','option','textbox','searchbox','combobox','spinbutton'
]);
const FILL_ROLES = new Set(['textbox','searchbox','combobox','spinbutton']);
const CLICK_ROLES = new Set(['button','link','checkbox','radio','switch','menuitem',
  'menuitemcheckbox','menuitemradio','tab','option']);
const ORIGIN_ERROR = '[ORIGIN_VIOLATION]';
const STATE_ERROR = '[STORAGE_STATE_VIOLATION]';

function canonicalOrigin(raw) {
  try {
    if (typeof raw !== 'string') throw Error('origin string required');
    const u = new URL(raw);
    if (raw !== u.origin || u.username || u.password ||
        !(u.protocol === 'https:' || u.protocol === 'http:' &&
          ['localhost','127.0.0.1','[::1]'].includes(u.hostname)))
      throw Error('canonical HTTPS origin required');
    return u;
  } catch { throw Error('[INVALID_ORIGIN]: Canonical HTTPS origin required (HTTP only for loopback)'); }
}
function assertSameOrigin(url, expected) {
  let u;
  try { u = new URL(url); } catch { throw Error(`${ORIGIN_ERROR}: Invalid navigation URL`); }
  if (u.origin !== expected || u.username || u.password ||
      !(u.protocol === 'https:' || u.protocol === 'http:' &&
        ['localhost','127.0.0.1','[::1]'].includes(u.hostname)))
    throw Error(`${ORIGIN_ERROR}: Navigation outside approved origin`);
}
function accessibleTarget(selector, action) {
  if (typeof selector !== 'string' || selector.length > 200)
    throw Error('[ACCESSIBLE_TARGET_REQUIRED]: Use an exact role or label');
  const role = /^role=([a-z][a-z0-9-]*)\[name="([^"\n]{1,120})"\]$/.exec(selector);
  if (role && ROLES.has(role[1]) &&
      (action === 'click' ? CLICK_ROLES.has(role[1]) : FILL_ROLES.has(role[1])))
    return {type:'role',role:role[1],name:role[2]};
  const label = /^label=([^\r\n]{1,120})$/.exec(selector);
  if (label && action === 'fill' && label[1].trim())
    return {type:'label',name:label[1]};
  throw Error('[ACCESSIBLE_TARGET_REQUIRED]: Use role=button[name="..."] or label=...');
}

export function validateScopedBrowserInput(params) {
  if (!params || typeof params !== 'object') throw TypeError('Browser action parameters required');
  const allowed = canonicalOrigin(params.allowedOrigin);
  assertSameOrigin(params.targetUrl, allowed.origin);
  if (!['click','fill'].includes(params.actionType)) throw Error('[ACTION_DENIED]: click/fill only');
  if (params.actionType === 'fill' &&
      (typeof params.fillValue !== 'string' || params.fillValue.length > 20000))
    throw Error('[INVALID_FILL_VALUE]: fill requires a bounded string, including empty');
  return { origin:allowed.origin, target:accessibleTarget(params.actionSelector,params.actionType) };
}

/** Reject instead of silently dropping foreign-origin credentials. */
export function parseOriginBoundStorageState(json, allowedOrigin) {
  if (json === undefined) return undefined;
  if (typeof json !== 'string' || Buffer.byteLength(json,'utf8') > 262144)
    throw Error(`${STATE_ERROR}: Storage state must be bounded JSON`);
  let state;
  try {state=JSON.parse(json);} catch {throw Error(`${STATE_ERROR}: Invalid JSON`);}
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      !Array.isArray(state.cookies) || !Array.isArray(state.origins) ||
      Object.keys(state).some(k=>!['cookies','origins'].includes(k)))
    throw Error(`${STATE_ERROR}: Invalid storage state structure`);
  const allowed = canonicalOrigin(allowedOrigin);
  if (state.cookies.length > 200 || state.origins.length > 20) 
    throw Error(`${STATE_ERROR}: State exceeds quota`);
  for (const cookie of state.cookies) {
    if (!cookie || typeof cookie !== 'object' || Array.isArray(cookie) ||
        typeof cookie.name !== 'string' || typeof cookie.value !== 'string' ||
        typeof cookie.domain !== 'string' || cookie.domain !== allowed.hostname ||
        typeof cookie.path !== 'string' || !cookie.path.startsWith('/') ||
        'partitionKey' in cookie ||
        cookie.name.length > 512 || cookie.value.length > 8192)
      throw Error(`${STATE_ERROR}: Cookie not host-bound to the approved origin`);
  }
  for (const entry of state.origins) {
    if (!entry || typeof entry !== 'object' || entry.origin !== allowedOrigin ||
        !Array.isArray(entry.localStorage) ||
        entry.localStorage.some(v=>!v || typeof v.name !== 'string' || typeof v.value !== 'string'))
      throw Error(`${STATE_ERROR}: Storage origin outside approved origin`);
  }
  // Playwright accepts its original state shape. Never log or return its contents.
  return state;
}

async function sessionRevoked(origin, options) {
  // Removal is awaited: a failed revocation is distinct from successful cleanup.
  try {await options.revokeSession(origin);}
  catch {throw Error('[SESSION_REVOCATION_FAILED]: Vault cleanup required');}
  throw Error('[SESSION_REVOKED]: Authentication expired; fresh owner login required');
}

/**
 * @param {object} params Validated owner-selected task; `actionSelector` is
 * `role=button[name="..."]` for click or `label=...` for fill.
 * @param {string} [storageStateJson] A vault-sourced state, never a browser profile.
 * @param {object} options Trusted host-only callbacks. NEVER derive approval
 * or session-validation callbacks from page text or an MCP tool argument.
 */
export async function runScopedBrowserTask(params, storageStateJson, options={}) {
  const {origin,target}=validateScopedBrowserInput(params);
  const state=parseOriginBoundStorageState(storageStateJson,origin);
  if (typeof options.authorizeAction !== 'function')
    throw Error('[APPROVAL_REQUIRED]: Trusted owner authorization callback required');
  if (state && typeof options.validateSession !== 'function')
    throw Error('[SESSION_VALIDATOR_REQUIRED]: Saved sessions need independent validation');
  if (state && typeof options.revokeSession !== 'function')
    throw Error('[SESSION_REVOCATION_HANDLER_REQUIRED]: Saved sessions need vault invalidation');
  let chromium = options.chromium;
  if (!chromium) {
    // The optional dependency is intentionally absent from the default CI app.
    try {chromium=(await import('playwright')).chromium;}
    catch {throw Error('[PLAYWRIGHT_UNAVAILABLE]: Install Playwright in approved browser worker');}
  }
  let browser,context;
  try {
    browser=await chromium.launch({headless:true});
    context=await browser.newContext({
      ...(state ? {storageState:state} : {}),
      serviceWorkers:'block',
      acceptDownloads:false,
      permissions:[],
    });
    // MUST be installed before first navigation. Reuses the repository's
    // redirect-safe HTTP policy, and blocks ALL WebSockets.
    await installNetworkPolicy(context,[origin]);
    const page=await context.newPage();
    // No auxiliary tab or popup receives the restored authenticated context.
    context.on?.('page', newPage=>{
      if (newPage !== page) void newPage.close().catch(()=>{});
    });
    const response=await page.goto(params.targetUrl,{waitUntil:'domcontentloaded',timeout:20000});
    assertSameOrigin(page.url(),origin);
    if (response?.status?.() === 401 || response?.status?.() === 403) {
      if (state) await sessionRevoked(origin,options);
      throw Error('[AUTH_REQUIRED]: Requested page denied access');
    }
    if (state && await options.validateSession(page,origin) !== true)
      await sessionRevoked(origin,options);
    const locator=target.type==='role'?
      page.getByRole(target.role,{name:target.name,exact:true}):
      page.getByLabel(target.name,{exact:true});
    if (await locator.count() !== 1 || await locator.isVisible() !== true)
      throw Error('[TARGET_NOT_UNIQUE]: Exactly one visible accessible target required');
    // A Playwright Locator can silently re-resolve after approval. Pin the
    // exact accessible DOM node before requesting the owner's grant.
    if (typeof locator.elementHandle !== 'function')
      throw Error('[ELEMENT_PIN_REQUIRED]: Browser must support stable element handles');
    const pinned = await locator.elementHandle({timeout:4000});
    if (!pinned) throw Error('[TARGET_GONE]: Accessible target detached');
    if (params.actionType === 'fill') {
      const inputType=String(await pinned.getAttribute('type')||'').toLowerCase();
      const autocomplete=String(await pinned.getAttribute('autocomplete')||'').toLowerCase();
      if (['password','hidden'].includes(inputType) ||
          /(?:one-time-code|current-password|new-password|cc-number|cc-csc)/.test(autocomplete))
        throw Error('[CREDENTIAL_TARGET_DENIED]: Secret and MFA controls require owner takeover');
    } else {
      // Trial checks actionability without dispatching a write.
      await pinned.click({trial:true,timeout:4000});
    }
    // Only a trusted owner-issued, action-specific grant may return true.
    // Do not include fillValue (which may be sensitive) in grant metadata.
    const approved=await options.authorizeAction(Object.freeze({
      targetUrl:params.targetUrl,origin,actionType:params.actionType,actionSelector:params.actionSelector,
    }));
    if (approved !== true) throw Error('[APPROVAL_DENIED]: Browser write not authorized');
    assertSameOrigin(page.url(),origin);
    if (params.actionType==='click') await pinned.click({timeout:10000});
    else await pinned.fill(params.fillValue,{timeout:10000});
    await page.waitForLoadState?.('domcontentloaded',{timeout:2000}).catch(()=>{});
    assertSameOrigin(page.url(),origin);
    // An expired session after a click is an ambiguous write, NOT permission
    // for blind retry. The owner must reconcile remote effect before replay.
    if (state && await options.validateSession(page,origin) !== true)
      await sessionRevoked(origin,options);
    if (typeof options.persistSession === 'function') {
      const candidate=await context.storageState();
      const verified=parseOriginBoundStorageState(JSON.stringify(candidate),origin);
      await options.persistSession(origin,verified);
    }
    return {success:true,finalUrl:page.url()};
  } finally {
    if(context) await context.close().catch(()=>{});
    if(browser) await browser.close().catch(()=>{});
  }
}
