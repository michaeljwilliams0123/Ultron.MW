import { createHash } from 'node:crypto';
import { validateUploadFile, verifyDownloadDestination, receiveDownload } from './file-transfer.mjs';
import { createBoundedMultipartBridge } from './multipart-bridge.mjs';

/**
 * Adapter to a provided Playwright Page. Not connected to an external
 * account or browser until the owner supplies a separate authenticated
 * browser runtime. No eval, hidden browser launch or credential access.
 */
export function createPlaywrightComputerDriver(initialPage, {
  tabs = { primary: initialPage }, windows = {}, uploadRoot, downloadRoot, uploadBridge,
} = {}) {
  let page = initialPage;
  if (!page || typeof page.goto !== 'function' ||
      typeof page.locator !== 'function' || typeof page.url !== 'function')
    throw TypeError('An actual Playwright Page is required');
  const slots = new Map([...Object.entries(tabs), ...Object.entries(windows)]);
  if (slots.get('primary') !== initialPage ||
      [...slots.keys()].some(key => !['primary','secondary','tertiary','window-secondary'].includes(key)) ||
      (windows['window-secondary'] && windows['window-secondary'].context() === initialPage.context()))
    throw Error('Browser tabs must be preallocated by the isolated launcher');
  // Keep the exact Playwright ElementHandle that passed the first trial.
  // A second preflight after owner consent checks that same node, and perform
  // never resolves the selector again to a replacement element.
  // Pages are explicitly created by the isolated launcher. Only this known
  // set may conduct unrelated reads while another page has a selected file.
  for (const slot of slots.values()) uploadBridge?.registerPage?.(slot);
  const preparedTargets = new Map();
  const preparedUploads = new Map();
  return Object.freeze({
    // Approval uses only preflighted metadata, never raw owner file contents.
    approvalMetadata(step) {
      if (step?.action !== 'upload') return null;
      const file = preparedUploads.get(step.id);
      return file ? Object.freeze({ fileSha256:file.sha256,
        fileBytes:file.bytes,fileName:file.name }) : null;
    },
    // A read-only actionability trial checks the intended target BEFORE
    // a human is asked to approve. It does not click, type or press a key.
    async preflight(step) {
      const locator = page.locator(step.selector);
      let target = preparedTargets.get(step.id);
      if (!target && typeof locator.elementHandle === 'function') {
        target = await locator.elementHandle({ timeout: 4000 });
        if (!target) throw Error('Browser target is unavailable');
        preparedTargets.set(step.id, target);
      }
      target ||= locator;
      if (step.action === 'click' || step.action === 'download') {
        if (step.action === 'download')
          await verifyDownloadDestination(downloadRoot, step.outputName);
        await target.click({ trial: true, timeout: 4000 });
      } else if (step.action === 'upload') {
        const file = await validateUploadFile(step.filePath, uploadRoot);
        if (typeof target.evaluate !== 'function' ||
            !await target.evaluate(el => el.tagName === 'INPUT' && el.type === 'file'))
          throw Error('Upload target is not a file input');
        const prior=preparedUploads.get(step.id);
        if (prior && (prior.sha256 !== file.sha256 || prior.bytes !== file.bytes ||
                      prior.path !== file.path))
          throw Error('Upload file changed after owner approval');
        preparedUploads.set(step.id, file);
      } else if (step.action === 'type' || step.action === 'keypress') {
        if (typeof target.waitForElementState === 'function')
          await target.waitForElementState('visible', { timeout: 4000 });
        else await target.waitFor({ state: 'visible', timeout: 4000 });
      }
      return true;
    },
    async observe() {
      const body = page.locator('body');
      const text = String(await body.innerText({ timeout: 10000 })).slice(0, 10000);
      // Visual and accessibility evidence stay in process memory only. Never
      // save screenshots, page HTML or account contents to GitHub/checkpoints.
      const screenshotDigest = typeof page.screenshot === 'function'
        ? createHash('sha256').update(await page.screenshot({
            type: 'png', animations: 'disabled', timeout: 10000,
          })).digest('hex') : null;
      const accessibilityDigest = typeof body.ariaSnapshot === 'function'
        ? createHash('sha256').update(String(await body.ariaSnapshot({
            timeout: 10000,
          })).slice(0, 10000)).digest('hex') : null;
      // Credential / MFA controls are never automation targets. A challenge
      // is a mandatory handoff to the owner, not a prompt for the model.
      let requiresOwnerTakeover = false;
      for (const selector of [
        'input[type="password"]:visible',
        'input[autocomplete="one-time-code"]:visible',
        'input[name="otp"]:visible',
      ]) {
        const credentialField = page.locator(selector);
        if (typeof credentialField.count === 'function' &&
            await credentialField.count() > 0) {
          requiresOwnerTakeover = true;
          break;
        }
      }
      // Push-based MFA and security-key prompts may have no input fields.
      // Page text can ONLY pause automation; it can never grant permission.
      if (/two.factor authentication|multi.factor authentication|one.time code|passkey|security key|verify it.s you|authenticator app/i.test(text))
        requiresOwnerTakeover = true;
      return {
        url: page.url(), title: String(await page.title()).slice(0, 240),
        text, screenshotDigest, accessibilityDigest, requiresOwnerTakeover,
      };
    },
    async perform(step) {
      const prepared = preparedTargets.get(step.id);
      try {
        switch (step.action) {
          case 'window-open':
          case 'tab-open': {
            const tab = slots.get(step.tabId || step.windowId);
            if (!tab) throw Error('Browser slot unavailable');
            if (tab.url() !== 'about:blank') throw Error('Browser tab already opened');
            await tab.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            page = tab;
            await tab.bringToFront();
            break;
          }
          case 'window-switch':
          case 'tab-switch': {
            const tab = slots.get(step.tabId || step.windowId);
            if (!tab) throw Error('Browser slot unavailable');
            if (tab.url() === 'about:blank') throw Error('Browser tab unopened');
            page = tab;
            await tab.bringToFront();
            break;
          }
          case 'window-close':
          case 'tab-close': {
            const tab = slots.get(step.tabId || step.windowId);
            if (!tab) throw Error('Browser slot unavailable');
            if (tab === slots.get('primary')) throw Error('Primary browser tab cannot close');
            page = slots.get('primary');
            await page.bringToFront();
            if (step.action === 'window-close') await tab.context().close();
            else await tab.close();
            slots.delete(step.tabId || step.windowId);
            break;
          }
          case 'navigate':
            await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); break;
          case 'upload': {
            const file = preparedUploads.get(step.id);
            if (!file) throw Error('Unprepared upload action');
            const fresh = await validateUploadFile(step.filePath, uploadRoot);
            if (fresh.sha256 !== file.sha256 || fresh.path !== file.path || fresh.bytes !== file.bytes)
              throw Error('Upload file changed after owner approval');
            const target = prepared || page.locator(step.selector);
            await target.setInputFiles(fresh.path, { timeout: 10000 });
            const selected = await target.evaluate(el =>
              [...(el.files || [])].map(f => ({ name: f.name, bytes: f.size })));
            if (selected.length !== 1 || selected[0].name !== fresh.name ||
                selected[0].bytes !== fresh.bytes)
              throw Error('Browser did not select the approved upload file');
            if (uploadBridge) {
              const fieldName = await target.evaluate(el => el.name);
              uploadBridge.arm(page, fresh, uploadRoot, fieldName);
            }
            return { verifiedEffect: true, fileSha256: fresh.sha256, bytes: fresh.bytes };
          }
          case 'download': {
            const target = prepared || page.locator(step.selector);
            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 20000 }),
              target.click({ timeout: 10000 }),
            ]);
            return await receiveDownload(download, downloadRoot, step.outputName);
          }
          case 'click': {
            const target = prepared || page.locator(step.selector);
            // This click was individually authorized by the executor.
            // It is the only point at which a selected file may be posted.
            if (uploadBridge) uploadBridge.approveSubmit(page, step.sendToOrigin);
            await target.click({ timeout: 10000 });
            break;
          }
          case 'type': {
            const target = prepared || page.locator(step.selector);
            await target.fill(step.value, { timeout: 10000 });
            // Never return or persist the typed value itself.
            return { fieldValueVerified: await target.inputValue({ timeout: 10000 }) === step.value };
          }
          case 'keypress':
            await (prepared || page.locator(step.selector)).press(step.key, { timeout: 10000 }); break;
          case 'scroll':
            await page.mouse.wheel(0, step.pixels); break;
          case 'wait':
            await page.locator(step.selector).waitFor({ state: 'visible', timeout: step.timeoutMs }); break;
          case 'extract':
            return { text: String(await page.locator(step.selector).innerText({
              timeout: 10000
            })).slice(0, 10000) };
          case 'observe':
            return null;
          default:
            throw Error('Unrecognized browser action');
        }
        return null;
      } finally {
        preparedUploads.delete(step.id);
        if (prepared) {
          preparedTargets.delete(step.id);
          try { await prepared.dispose?.(); } catch {}
        }
      }
    },
  });
}

/**
 * Request interception is required before the first navigation. Origins are
 * canonical and explicit. Even page-loaded scripts and redirects cannot
 * silently fetch a new HTTP(S) destination, including cross-origin assets.
 * This is a hostname-level policy; hosted workers additionally need DNS/IP
 * egress controls before accessing sensitive networks.
 */
export async function installNetworkPolicy(context, allowedOrigins, { uploadBridge } = {}) {
  if (!context || typeof context.route !== 'function' ||
      !Array.isArray(allowedOrigins) || !allowedOrigins.length ||
      allowedOrigins.some(origin => {
        try {
          const url = new URL(origin);
          return url.origin !== origin || url.username || url.password ||
            !['https:', 'http:'].includes(url.protocol) ||
            url.protocol === 'http:' &&
              !['localhost','127.0.0.1','[::1]'].includes(url.hostname);
        } catch { return true; }
      }))
    throw Error('Network boundary requires canonical allowed origins');
  if (typeof context.routeWebSocket !== 'function')
    throw Error('Playwright runtime lacks WebSocket interception; update isolated executor');
  const allowed = new Set(allowedOrigins);
  await context.route('**/*', async route => {
    try {
      const target = new URL(route.request().url());
      if (!['https:', 'http:'].includes(target.protocol) ||
          target.username || target.password || !allowed.has(target.origin)) {
        await route.abort('blockedbyclient');
        return;
      }
    } catch {
      await route.abort('blockedbyclient');
      return;
    }
    // Chromium may follow redirects without a second interception.
    // Never route.continue() a multipart POST: it would preserve its upload
    // stream but could follow an out-of-allowlist Location. Instead send
    // one bounded request via route.fetch(maxRedirects: 0), retaining the
    // only the bound, independently revalidated approved file as postData.
    const request = route.request();
    if (uploadBridge) {
      let page = null;
      try { page = request.frame?.().page?.(); } catch {}
      // Fail closed when any selected file remains in a page, including
      // non-multipart fetch(), GET query exfiltration and unknown frames.
      if (uploadBridge.mustBlockRequest?.(page, request)) {
        await route.abort('blockedbyclient');
        return;
      }
    }
    const headers = typeof request.headers === 'function' ? request.headers() : {};
    const contentType = String(headers['content-type'] || '').toLowerCase();
    const isMultipart = typeof request.method === 'function' && request.method() === 'POST' &&
      contentType.startsWith('multipart/form-data');
    let postData = null;
    if (isMultipart) {
      try {
        if (!uploadBridge) throw Error('File transfer not approved');
        postData = await uploadBridge.rehydrate(request);
      } catch {
        await route.abort('blockedbyclient');
        return;
      }
    }
    // Chromium can follow a fulfilled 3xx without another route callback.
    // Fetch one hop without following it. A safe GET/POST navigation redirect
    // is converted into a tiny same-origin interstitial whose new navigation
    // re-enters this route policy. Cross-origin, subresource and method-
    // preserving redirects remain blocked. Preserve response cookies so a
    // successful owner-completed login can establish its isolated session.
    if (typeof route.fetch !== 'function' || typeof route.fulfill !== 'function') {
      await route.abort('blockedbyclient').catch(() => {});
      return;
    }
    try {
      const response = await route.fetch({ maxRedirects: 0, timeout: 10000,
        ...(isMultipart ? { postData } : {}),
      });
      if (response.status() >= 300 && response.status() < 400) {
        const request = route.request();
        const method = typeof request.method === 'function' ? request.method() : '';
        const isNavigation = typeof request.isNavigationRequest === 'function' &&
          request.isNavigationRequest();
        const headers = typeof response.headers === 'function' ? response.headers() : {};
        const location = Object.entries(headers).find(([name]) =>
          name.toLowerCase() === 'location')?.[1];
        let target = null;
        try { target = location ? new URL(location, request.url()) : null; }
        catch { /* Invalid redirect target remains blocked. */ }
        if (![301, 302, 303].includes(response.status()) || !isNavigation ||
            !['GET', 'POST'].includes(method) || !target ||
            target.username || target.password || !allowed.has(target.origin)) {
          // The original request may already have changed server state.
          // Executor reconciliation must refuse blind replay.
          await route.abort('blockedbyclient');
          return;
        }
        const forwarded = { ...headers };
        for (const name of Object.keys(forwarded)) {
          if (['location','content-length','content-encoding','content-type',
            'content-security-policy'].includes(name.toLowerCase())) delete forwarded[name];
        }
        forwarded['content-type'] = 'text/html; charset=utf-8';
        forwarded['cache-control'] = 'no-store';
        forwarded['content-security-policy'] =
          "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
        const serialized = JSON.stringify(target.href).replace(/</g, '\\u003c');
        await route.fulfill({ status: 200, headers: forwarded,
          body: '<!doctype html><meta charset="utf-8"><title>Redirecting</title>' +
            '<script>location.replace(' + serialized + ')</script>' });
        return;
      }
      await route.fulfill({ response });
    } catch {
      // Unknown response or a closed page is not proof of a completed write.
      await route.abort('failed').catch(() => {});
    }
  });
  // WebSocket messages bypass HTTP route interception in some Playwright
  // versions. Refuse them entirely in the initial browser worker.
  await context.routeWebSocket('**/*', socket => socket.close());
}

/**
 * The dependency is deliberately optional: the existing production Pages
 * site, CI and lockfile are unchanged. Use in an isolated owner-approved
 * runtime after installing Playwright and its browsers in that environment.
 */
export async function launchIsolatedBrowser(options = {}) {
  if (options.headless !== true &&
      !(options.headless === false && options.ownerApproval === true))
    throw Error('Headed browser requires explicit local owner approval');
  if (options.channel !== undefined && options.channel !== 'chrome')
    throw Error('Unsupported browser channel; only system Chrome is admitted');
  // Validate policy BEFORE importing optional dependencies: a clean CI host
  // without Playwright must still reject an unsafe channel deterministically.
  let pw;
  try { pw = await import('playwright'); }
  catch { throw Error('Playwright not installed in this execution environment'); }
  const browser = await pw.chromium.launch({
    headless: options.headless === true,
    ...(options.channel ? { channel: options.channel } : {}),
  });
  try {
    const uploadBridge = createBoundedMultipartBridge();
    const context = await browser.newContext({
      acceptDownloads: Boolean(options.downloadRoot), serviceWorkers: 'block',
    });
    await installNetworkPolicy(context, options.allowedOrigins, { uploadBridge });
    const page = await context.newPage();
    // Optional multi-tab uses a fixed set of preallocated pages created
    // before any untrusted website can execute. All arbitrary popups close.
    const tabs = { primary: page };
    if (options.enableTabs === true) {
      tabs.secondary = await context.newPage();
      tabs.tertiary = await context.newPage();
    }
    const admitted = new Set(Object.values(tabs));
    context.on('page', opened => {
      if (!admitted.has(opened)) void opened.close().catch(() => {});
    });
    const windows = {};
    if (options.enableWindows === true) {
      // A separate isolated context produces a separate native Chrome window.
      // Session cookies and site storage are not inherited across windows.
      const secondary = await browser.newContext({
        acceptDownloads: Boolean(options.downloadRoot), serviceWorkers: 'block',
      });
      await installNetworkPolicy(secondary, options.allowedOrigins, { uploadBridge });
      const secondaryPage = await secondary.newPage();
      windows['window-secondary'] = secondaryPage;
      secondary.on('page', opened => {
        if (opened !== secondaryPage) void opened.close().catch(() => {});
      });
    }
    return { page, driver: createPlaywrightComputerDriver(page, {
      tabs, windows, uploadRoot: options.uploadRoot, downloadRoot: options.downloadRoot,
      uploadBridge,
    }),
      async close() { await browser.close(); } };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
