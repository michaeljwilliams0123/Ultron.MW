import { createHash } from 'node:crypto';

/**
 * Adapter to a provided Playwright Page. Not connected to an external
 * account or browser until the owner supplies a separate authenticated
 * browser runtime. No eval, hidden browser launch or credential access.
 */
export function createPlaywrightComputerDriver(page) {
  if (!page || typeof page.goto !== 'function' ||
      typeof page.locator !== 'function' || typeof page.url !== 'function')
    throw TypeError('An actual Playwright Page is required');
  return Object.freeze({
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
      switch (step.action) {
        case 'navigate':
          await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); break;
        case 'click':
          await page.locator(step.selector).click({ timeout: 10000 }); break;
        case 'type': {
          const target = page.locator(step.selector);
          await target.fill(step.value, { timeout: 10000 });
          // Never return or persist the typed value itself.
          return { fieldValueVerified: await target.inputValue({ timeout: 10000 }) === step.value };
        }
        case 'keypress':
          await page.locator(step.selector).press(step.key, { timeout: 10000 }); break;
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
export async function installNetworkPolicy(context, allowedOrigins) {
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
    // Chromium follows 3xx fulfilled responses WITHOUT a second route
    // callback. Resolve every hop ourselves, with explicit origin checks.
    // Follow only read-only redirects; a POST may transition to GET on 303.
    // Never repeat an already-dispatched write on 307/308 or ambiguous errors.
    if (typeof route.fetch !== 'function' || typeof route.fulfill !== 'function') {
      await route.abort('blockedbyclient').catch(() => {});
      return;
    }
    try {
      let response = await route.fetch({ maxRedirects: 0, timeout: 10000 });
      let current = route.request().url();
      let method = route.request().method?.() || 'GET';
      let hops = 0;
      while (response.status() >= 300 && response.status() < 400) {
        const status = response.status();
        const location = response.headers()['location'];
        if (!location || hops++ >= 5) {
          await route.abort('blockedbyclient');
          return;
        }
        let next;
        try { next = new URL(location, current); }
        catch { await route.abort('blockedbyclient'); return; }
        if (!['https:', 'http:'].includes(next.protocol) ||
            next.username || next.password || !allowed.has(next.origin)) {
          await route.abort('blockedbyclient');
          return;
        }
        // Treat POST/Redirect/GET as safe to READ after the original write.
        // Never resend POST or another mutating method as part of the chain.
        if (status === 303 || ((status === 301 || status === 302) &&
            method === 'POST')) method = 'GET';
        if (!['GET', 'HEAD'].includes(method) ||
            typeof context.request?.fetch !== 'function') {
          await route.abort('blockedbyclient');
          return;
        }
        current = next.href;
        response = await context.request.fetch(current, {
          method, maxRedirects: 0, timeout: 10000,
        });
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
  let pw;
  try { pw = await import('playwright'); }
  catch { throw Error('Playwright not installed in this execution environment'); }
  if (options.channel !== undefined && options.channel !== 'chrome')
    throw Error('Only explicitly requested system Chrome is supported');
  const browser = await pw.chromium.launch({
    headless: options.headless === true,
    ...(options.channel ? { channel: options.channel } : {}),
  });
  try {
    const context = await browser.newContext({
      acceptDownloads: false, serviceWorkers: 'block',
    });
    await installNetworkPolicy(context, options.allowedOrigins);
    const page = await context.newPage();
    // A popup is a new authority surface: close rather than follow it.
    context.on('page', opened => {
      if (opened !== page) void opened.close().catch(() => {});
    });
    return { page, driver: createPlaywrightComputerDriver(page),
      async close() { await browser.close(); } };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
