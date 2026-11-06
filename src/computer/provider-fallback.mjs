import { createBoundComputerExecutor, validateComputerBinding } from './binding-contract.mjs';
import { normalizeComputerPlan } from './executor.mjs';
import { launchIsolatedBrowser } from './playwright-driver.mjs';

/**
 * The provider must report unsupported before attempting an effect. Failures,
 * exceptions, and uncertain outcomes must never cause browser replay.
 */
export function createProviderFirstExecutor({
  binding, store, authorize, canContinue, provider, launch = launchIsolatedBrowser,
  browserDeadlineMs = 120000,
} = {}) {
  const manifest = validateComputerBinding(binding);
  if (!manifest.enabled || typeof store?.read !== 'function' ||
      typeof store?.write !== 'function' || typeof store?.withLock !== 'function' ||
      typeof authorize !== 'function' || typeof canContinue !== 'function' ||
      typeof provider !== 'function' || typeof launch !== 'function' ||
      !Number.isSafeInteger(browserDeadlineMs) || browserDeadlineMs < 1 ||
      browserDeadlineMs > 120000)
    throw Error('Provider fallback requires an enabled binding, durable lock, and explicit authority');
  const pinnedBinding = Object.freeze({
    id: manifest.id, kind: manifest.kind, runtime: manifest.runtime,
    enabled: manifest.enabled, allowedOrigins: manifest.allowedOrigins,
    operations: manifest.operations, maxSteps: manifest.maxSteps,
    credentialRef: manifest.credentialRef,
  });

  return Object.freeze({
    async run({ request, plan } = {}) {
      // Only a provider's explicit pre-dispatch decision admits fallback.
      // Thrown exceptions are deliberately propagated, never treated as unsupported.
      const result = await provider(request);
      if (!result || typeof result !== 'object' ||
          !['completed', 'unsupported', 'held', 'reconcile-required'].includes(result.status))
        throw Error('Provider returned an invalid execution result');
      if (result.status !== 'unsupported') return { route: 'provider', result };
      if (result.dispatched !== false)
        throw Error('Provider fallback requires explicit pre-dispatch evidence');
      if (!plan || !Array.isArray(plan.steps) || plan.steps.length > manifest.maxSteps ||
          plan.steps.some(step => !manifest.operations.includes(step?.action)))
        throw Error('Fallback plan exceeds binding capabilities');
      const admittedPlan = normalizeComputerPlan(plan, { allowedOrigins: manifest.allowedOrigins });
      // Fresh ephemeral context, with interception configured by the isolated launcher
      // before any page is created. Never carry provider credentials into the browser.
      const browser = await launch({
        headless: true,
        allowedOrigins: manifest.allowedOrigins,
        enableTabs: admittedPlan.steps.some(step => step.action.startsWith('tab-')),
        enableWindows: admittedPlan.steps.some(step => step.action.startsWith('window-')),
      });
      if (!browser || !browser.driver || typeof browser.close !== 'function') {
        if (typeof browser?.close === 'function') await browser.close();
        throw Error('Isolated browser launcher returned an invalid session');
      }
      const deadline = performance.now() + browserDeadlineMs;
      let expired = false;
      const isLive = () => !expired && performance.now() < deadline;
      const guardedDriver = new Proxy(browser.driver, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if (typeof value !== 'function' || property === 'endRun')
            return typeof value === 'function' ? value.bind(target) : value;
          return (...args) => {
            if (!isLive()) throw Error('Browser execution deadline exceeded');
            return Reflect.apply(value, target, args);
          };
        },
      });
      let output, executionError, cleanupError, timer;
      try {
        const executor = createBoundComputerExecutor({
          binding: pinnedBinding, store, driver: guardedDriver,
          authorize: async context => isLive() && await authorize(context) === true && isLive(),
          canContinue: async context => isLive() && await canContinue(context) === true && isLive(),
        });
        const timeout = new Promise(resolve => {
          timer = setTimeout(() => {
            expired = true;
            resolve({ timedOut: true });
          }, browserDeadlineMs);
        });
        const outcome = await Promise.race([
          executor.run(admittedPlan).then(result => ({ result })),
          timeout,
        ]);
        if (outcome.timedOut || !isLive()) {
          expired = true;
          output = { route: 'browser', result: { status: 'reconcile-required',
            id: admittedPlan.id, reason: 'Browser deadline exceeded; inspect before retrying' } };
        } else output = { route: 'browser', result: outcome.result };
      } catch (error) { executionError = error; }
      finally { clearTimeout(timer); }
      try { await browser.close(); } catch (error) { cleanupError = error; }
      if (executionError && cleanupError)
        throw new AggregateError([executionError, cleanupError], 'Browser execution and cleanup failed');
      if (executionError) throw executionError;
      if (cleanupError) throw cleanupError;
      return output;
    },
  });
}
