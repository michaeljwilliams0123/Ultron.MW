import { createHash } from 'node:crypto';
const ID = /^[a-z0-9][a-z0-9_.:-]{2,79}$/i;
const PATH_RE = /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]*$/;
const ERROR_TITLE_RE = /^(?:temporarily unavailable|service unavailable|too many requests|access denied|forbidden|not found|unauthorized|bad gateway|gateway timeout|internal server error|error\b|attention required|just a moment|401\b|403\b|404\b|429\b|500\b|502\b|503\b|504\b)/i;
const ALLOWED_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const pathOk = p => typeof p === 'string' && p.length <= 512 && PATH_RE.test(p) && !p.split('/').some(x => x === '.' || x === '..');
const validOrigin = o => { try { const u = new URL(o); return u.protocol === 'https:' && u.origin === o; } catch { return false; } };

export function createPlaywrightReadAdapter({
  origin,
  actorRef = 'owner:ultron',
  allowedPaths = ['/browser-write-acceptance.html'],
  timeoutMs = 15000,
  requiredMarker = null,
  loadPlaywright = async () => import('playwright'),
} = {}) {
  if (!validOrigin(origin) || !ID.test(actorRef || '') ||
      !Array.isArray(allowedPaths) || !allowedPaths.length || allowedPaths.length > 32 ||
      allowedPaths.some(p => !pathOk(p)) || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000 ||
      (requiredMarker !== null && typeof requiredMarker !== 'string' && !(requiredMarker instanceof RegExp))) {
    throw Error('native-host-playwright-config-invalid');
  }
  const permitted = new Set(allowedPaths);
  let lastObserved = null;
  let generation = 0;
  const admitted = u => u.origin === origin && permitted.has(u.pathname) && u.href === origin + u.pathname && !u.username && !u.password && !u.search && !u.hash;

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
      let u;
      try {
        u = new URL(input.url);
      } catch {
        throw Error('native-host-playwright-path-denied');
      }
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
        let routeRejection = null;
        let responseStatus = 200;
        let responseContentType = 'text/html';
        let blockedActivity = false;
        const context = await browser.newContext({ acceptDownloads: false, javaScriptEnabled: false, serviceWorkers: 'block' });
        context.on?.('page', extraPage => {
          blockedActivity = true;
          extraPage?.close?.().catch(() => {});
        });
        await context.route('**/*', async route => {
          const request = route.request();
          if (request.method() !== 'GET' || !request.isNavigationRequest() || request.url() !== u.href) {
            blockedActivity = true;
            return route.abort();
          }
          try {
            const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: timeoutMs });
            const status = response.status();
            const headers = typeof response.headers === 'function' ? (response.headers() || {}) : {};
            const ct = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            if (status >= 300 && status < 400) {
              routeRejection = Error('native-host-playwright-redirect-denied');
              return route.abort();
            }
            if (!Number.isInteger(status) || status < 200 || status >= 300) {
              routeRejection = Error(`native-host-playwright-http-status-${status}`);
              return route.abort();
            }
            if (ct && !ALLOWED_CONTENT_TYPES.has(ct)) {
              routeRejection = Error('native-host-playwright-content-type-denied');
              return route.abort();
            }
            responseStatus = status;
            if (ct) responseContentType = ct;
            await route.fulfill({ response });
          } catch {
            if (!routeRejection) routeRejection = Error('native-host-playwright-network-failed');
            await route.abort();
          }
        });
        const page = await context.newPage();
        page.on?.('download', download => {
          blockedActivity = true;
          download?.cancel?.().catch(() => {});
        });
        page.setDefaultTimeout(timeoutMs);
        let mainResponse = null;
        try {
          mainResponse = await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        } catch (err) {
          if (routeRejection) throw routeRejection;
          throw err;
        }
        if (routeRejection) throw routeRejection;
        if (blockedActivity) throw Error('native-host-playwright-activity-denied');
        if (mainResponse) {
          const mStatus = typeof mainResponse.status === 'function' ? mainResponse.status() : 200;
          if (!Number.isInteger(mStatus) || mStatus < 200 || mStatus >= 300) {
            throw Error(`native-host-playwright-http-status-${mStatus}`);
          }
          if (typeof mainResponse.headers === 'function') {
            const hdrs = mainResponse.headers() || {};
            const ct = String(hdrs['content-type'] || '').split(';')[0].trim().toLowerCase();
            if (ct && !ALLOWED_CONTENT_TYPES.has(ct)) {
              throw Error('native-host-playwright-content-type-denied');
            }
            if (ct) responseContentType = ct;
          }
          responseStatus = mStatus;
        }
        const finalUrl = new URL(page.url());
        if (!admitted(finalUrl) || finalUrl.href !== u.href) {
          throw Error('native-host-playwright-origin-redirect-denied');
        }
        const summary = await page.evaluate(() => ({
          title: String(document.title || '').slice(0, 200),
          headingCount: document.querySelectorAll('h1,h2,h3').length,
          textSample: String(document.body?.innerText || document.documentElement?.textContent || '').slice(0, 2000),
        }));
        const safeTitle = String(summary?.title || '').trim().slice(0, 200);
        if (ERROR_TITLE_RE.test(safeTitle)) {
          throw Error('native-host-playwright-error-document-denied');
        }
        const textSample = String(summary?.textSample || '');
        if (typeof requiredMarker === 'string' && !textSample.includes(requiredMarker)) {
          throw Error('native-host-playwright-acceptance-marker-missing');
        }
        if (requiredMarker instanceof RegExp && !requiredMarker.test(textSample)) {
          throw Error('native-host-playwright-acceptance-marker-missing');
        }
        const result = {
          url: finalUrl.origin + finalUrl.pathname,
          status: responseStatus,
          contentType: responseContentType,
          title: safeTitle,
          headingCount: Number.isSafeInteger(summary?.headingCount) ? summary.headingCount : 0,
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
        try {
          await browser.close();
        } catch (error) {
          if (attempt === generation) lastObserved = null;
          throw error;
        }
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
