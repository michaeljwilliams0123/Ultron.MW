import { createHash } from 'node:crypto';

const ID = /^[a-z0-9][a-z0-9_.:-]{2,79}$/i;
const PATH_RE = /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]*$/;
const ALLOWED_OPS = new Set(['page.navigate', 'page.discover', 'page.fill', 'page.click', 'page.submit', 'page.compensate']);
const ERROR_TITLE_RE = /^(?:temporarily unavailable|service unavailable|too many requests|access denied|forbidden|not found|unauthorized|bad gateway|gateway timeout|internal server error|error\b|401\b|403\b|404\b|429\b|500\b|502\b|503\b|504\b)/i;
const ALLOWED_CT = new Set(['text/html', 'application/xhtml+xml', 'application/json']);

const pathOk = p => typeof p === 'string' && p.length <= 512 && PATH_RE.test(p) && !p.split('/').some(x => x === '.' || x === '..');
const validOrigin = o => {
  try {
    const u = new URL(o);
    const localHttp = u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    return (u.protocol === 'https:' || localHttp) && u.origin === o;
  } catch {
    return false;
  }
};

export function createNativeBrowserWriteAdapter({
  origin,
  actorRef = 'owner:ultron',
  allowedPaths = ['/browser-write-acceptance.html'],
  timeoutMs = 15_000,
  authorizeBeforeDispatch = null,
  loadPlaywright = async () => import('playwright'),
} = {}) {
  if (!validOrigin(origin) || !ID.test(actorRef || '') ||
      !Array.isArray(allowedPaths) || !allowedPaths.length || allowedPaths.length > 32 ||
      allowedPaths.some(p => !pathOk(p)) || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30_000 ||
      (authorizeBeforeDispatch !== null && typeof authorizeBeforeDispatch !== 'function')) {
    throw Error('native-browser-write-config-invalid');
  }
  const permitted = new Set(allowedPaths);
  const admitted = u => u.origin === origin && permitted.has(u.pathname) && u.href === origin + u.pathname && !u.username && !u.password && !u.search && !u.hash;
  let lastObserved = null;
  let generation = 0;

  return Object.freeze({
    async health() {
      try {
        const pw = await loadPlaywright();
        if (typeof pw?.chromium?.launch !== 'function') return { status: 'held', actorRef, grantedScopes: [] };
        return { status: 'ready', actorRef, grantedScopes: ['page.read', 'page.write'] };
      } catch {
        return { status: 'held', actorRef, grantedScopes: [] };
      }
    },
    async execute({ operation, input, estimatedCostCents } = {}) {
      const attempt = ++generation;
      lastObserved = null;
      if (!ALLOWED_OPS.has(operation) || estimatedCostCents !== 0 || typeof input?.url !== 'string') {
        throw Error('native-browser-write-request-invalid');
      }
      let u;
      try { u = new URL(input.url); } catch { throw Error('native-browser-write-path-denied'); }
      if (!admitted(u)) throw Error('native-browser-write-path-denied');

      let pw;
      try { pw = await loadPlaywright(); } catch { throw Error('native-browser-write-playwright-unavailable'); }
      if (typeof pw?.chromium?.launch !== 'function') throw Error('native-browser-write-playwright-unavailable');
      if (authorizeBeforeDispatch && (await authorizeBeforeDispatch()) !== true) {
        throw Error('native-browser-write-authorization-revoked');
      }

      const browser = await pw.chromium.launch({ headless: true });
      try {
        let routeRejection = null;
        let blockedActivity = false;
        const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
        await context.route('**/*', async route => {
          const req = route.request();
          const reqUrl = new URL(req.url());
          if (reqUrl.origin !== origin || (req.isNavigationRequest() && !admitted(reqUrl))) {
            blockedActivity = true;
            return route.abort();
          }
          try {
            const resp = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: timeoutMs });
            const st = resp.status();
            const hdrs = typeof resp.headers === 'function' ? (resp.headers() || {}) : {};
            const ct = String(hdrs['content-type'] || '').split(';')[0].trim().toLowerCase();
            if (st >= 300 && st < 400) {
              routeRejection = Error('native-browser-write-redirect-denied');
              return route.abort();
            }
            if (st < 200 || st >= 300) {
              routeRejection = Error(`native-browser-write-http-status-${st}`);
              return route.abort();
            }
            if (ct && !ALLOWED_CT.has(ct)) {
              routeRejection = Error('native-browser-write-content-type-denied');
              return route.abort();
            }
            await route.fulfill({ response: resp });
          } catch {
            if (!routeRejection) routeRejection = Error('native-browser-write-network-failed');
            await route.abort();
          }
        });

        const page = await context.newPage();
        context.on?.('page', extra => {
          if (extra && extra !== page) {
            blockedActivity = true;
            extra?.close?.().catch(() => {});
          }
        });
        page.on?.('download', d => { blockedActivity = true; d?.cancel?.().catch(() => {}); });
        page.setDefaultTimeout(timeoutMs);

        try {
          await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        } catch (err) {
          if (routeRejection) throw routeRejection;
          throw err;
        }
        if (routeRejection) throw routeRejection;
        if (blockedActivity) throw Error('native-browser-write-activity-denied');

        const finalUrl = new URL(page.url());
        if (!admitted(finalUrl)) throw Error('native-browser-write-origin-redirect-denied');

        let actionOutcome = {};
        if (operation === 'page.discover') {
          actionOutcome = await page.evaluate(() => ({
            title: String(document.title || '').slice(0, 200),
            forms: document.querySelectorAll('form').length,
            inputs: Array.from(document.querySelectorAll('input,textarea,select')).map(el => el.getAttribute('name') || el.id || '').filter(Boolean).slice(0, 20),
          }));
        } else if (operation === 'page.fill') {
          if (typeof input.selector !== 'string' || typeof input.value !== 'string') throw Error('native-browser-write-fill-invalid');
          await page.fill(input.selector, input.value);
          actionOutcome = { filled: input.selector };
        } else if (operation === 'page.click') {
          if (typeof input.selector !== 'string') throw Error('native-browser-write-click-invalid');
          await page.click(input.selector);
          actionOutcome = { clicked: input.selector };
        } else if (operation === 'page.submit' || operation === 'page.compensate') {
          if (Array.isArray(input.fields)) {
            for (const f of input.fields) {
              if (typeof f?.selector !== 'string' || typeof f?.value !== 'string') throw Error('native-browser-write-field-invalid');
              await page.fill(f.selector, f.value);
            }
          }
          if (typeof input.submitSelector === 'string') {
            await page.click(input.submitSelector);
          }
          actionOutcome = await page.evaluate(() => ({
            title: String(document.title || '').slice(0, 200),
            statusText: String(document.body?.innerText || '').slice(0, 500),
          }));
        } else {
          actionOutcome = await page.evaluate(() => ({
            title: String(document.title || '').slice(0, 200),
          }));
        }

        if (ERROR_TITLE_RE.test(String(actionOutcome?.title || ''))) {
          throw Error('native-browser-write-error-document-denied');
        }

        const result = {
          operation,
          url: finalUrl.origin + finalUrl.pathname,
          ...actionOutcome,
        };
        if (attempt === generation) {
          lastObserved = {
            origin: finalUrl.origin,
            pathname: finalUrl.pathname,
            resultDigest: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
          };
        }
        return result;
      } finally {
        try { await browser.close(); } catch (err) { if (attempt === generation) lastObserved = null; throw err; }
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
