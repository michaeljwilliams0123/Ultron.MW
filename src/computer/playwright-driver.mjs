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
      return {
        url: page.url(),
        title: String(await page.title()).slice(0, 240),
        text: String(await page.locator('body').innerText({ timeout: 10000 })).slice(0, 10000),
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
          !allowed.has(target.origin)) {
        await route.abort('blockedbyclient');
        return;
      }
    } catch {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
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
  if (options.headless !== true)
    throw Error('Headed browser requires a separately approved runtime');
  // A supported local Chrome installation can replace a separate downloaded
  // Playwright Chromium binary. Never pass arbitrary executables or channels.
  if (options.channel !== undefined && options.channel !== 'chrome')
    throw Error('Unsupported browser channel');
  let pw;
  try { pw = await import('playwright'); }
  catch { throw Error('Playwright not installed in this execution environment'); }
  const browser = await pw.chromium.launch({
    headless: true, ...(options.channel ? { channel: options.channel } : {}),
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
