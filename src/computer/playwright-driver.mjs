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
        case 'type':
          await page.locator(step.selector).fill(step.value, { timeout: 10000 }); break;
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
 * The dependency is deliberately optional: the existing production Pages
 * site, CI and lockfile are unchanged. Use in an isolated owner-approved
 * runtime after installing Playwright and its browsers in that environment.
 */
export async function launchIsolatedBrowser(options = {}) {
  if (options.headless !== true)
    throw Error('Headed browser requires a separately approved runtime');
  let pw;
  try { pw = await import('playwright'); }
  catch { throw Error('Playwright not installed in this execution environment'); }
  const browser = await pw.chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: false, serviceWorkers: 'block',
  });
  const page = await context.newPage();
  return { page, driver: createPlaywrightComputerDriver(page),
    async close() { await browser.close(); } };
}
