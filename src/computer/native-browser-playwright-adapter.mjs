import { createHash } from 'node:crypto';
const ID = /^[a-z0-9][a-z0-9_.:-]{2,79}$/i;
const PATH_RE = /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]*$/;
const pathOk = p => typeof p === 'string' && p.length <= 512 && PATH_RE.test(p) && !p.split('/').some(x => x === '.' || x === '..');
const validOrigin = o => { try { const u = new URL(o); return u.protocol === 'https:' && u.origin === o; } catch { return false; } };

export function createPlaywrightReadAdapter({
  origin,
  actorRef = 'owner:ultron',
  allowedPaths = ['/browser-write-acceptance.html'],
  timeoutMs = 15000,
  loadPlaywright = async () => import('playwright'),
} = {}) {
  if (!validOrigin(origin) || !ID.test(actorRef || '') ||
      !Array.isArray(allowedPaths) || !allowedPaths.length || allowedPaths.length > 32 ||
      allowedPaths.some(p => !pathOk(p)) || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw Error('native-host-playwright-config-invalid');
  }
  const permitted = new Set(allowedPaths);
  let lastObserved = null;
  let generation = 0;
  const admitted = u => u.origin === origin && permitted.has(u.pathname) && u.href === origin + u.pathname;

  return Object.freeze({
    async health() {
      try {
        const pw = await loadPlaywright();
        if (typeof pw?.chromium?.launch !== 'function') {
          return { status: 'held', actorRef, grantedScopes: [] };
        }
        return { status: 'ready', actorRef, grantedScopes: ['page.read'] };
      } catch {
        return { status: 'held', actorRef, grantedScopes: [] };
      }
    },
    async execute({ operation, input, estimatedCostCents } = {}) {
      const attempt = ++generation;
      lastObserved = null;
      if (operation !== 'page.inspect' || estimatedCostCents !== 0 || typeof input?.url !== 'string') {
        throw Error('native-host-playwright-request-invalid');
      }
      const u = new URL(input.url);
      if (!admitted(u)) {
        throw Error('native-host-playwright-path-denied');
      }
      let pw;
      try {
        pw = await loadPlaywright();
      } catch {
        throw Error('native-host-playwright-unavailable');
      }
      if (typeof pw?.chromium?.launch !== 'function') {
        throw Error('native-host-playwright-unavailable');
      }
      const browser = await pw.chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({ acceptDownloads: false, javaScriptEnabled: false, serviceWorkers: 'block' });
        await context.route('**/*', async route => {
          const request = route.request();
          if (request.method() !== 'GET' || !request.isNavigationRequest() || request.url() !== u.href) return route.abort();
          try {
            const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: timeoutMs });
            if (response.status() >= 300 && response.status() < 400) return route.abort();
            await route.fulfill({ response });
          } catch { await route.abort(); }
        });
        const page = await context.newPage();
        page.setDefaultTimeout(timeoutMs);
        await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        const finalUrl = new URL(page.url());
        if (!admitted(finalUrl) || finalUrl.href !== u.href) {
          throw Error('native-host-playwright-origin-redirect-denied');
        }
        const summary = await page.evaluate(() => ({
          title: String(document.title || '').slice(0, 200),
          headingCount: document.querySelectorAll('h1,h2,h3').length,
        }));
        const result = {
          url: finalUrl.origin + finalUrl.pathname,
          title: String(summary?.title || '').slice(0, 200),
          headingCount: Number.isSafeInteger(summary?.headingCount) ? summary.headingCount : 0,
        };
        if (attempt === generation) lastObserved = { origin: finalUrl.origin, pathname: finalUrl.pathname, resultDigest: createHash('sha256').update(JSON.stringify(result)).digest('hex') };
        return result;
      } finally {
        try { await browser.close(); } catch (error) { if (attempt === generation) lastObserved = null; throw error; }
      }
    },
    async observe({ query } = {}) {
      const verified = Boolean(
        lastObserved &&
        lastObserved.origin === origin &&
        permitted.has(lastObserved.pathname) &&
        typeof query?.resultDigest === 'string' &&
        query.resultDigest === lastObserved.resultDigest,
      );
      return { verified, origin };
    },
    async unbind() {
      generation++;
      lastObserved = null;
      return { revoked: true };
    },
  });
}
