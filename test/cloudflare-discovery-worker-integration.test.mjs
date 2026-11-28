import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';

// Resolve the Worker's extensionless imports in Node; simulate only its platform base class.
const root = new URL('../cloudflare/edge-shield/src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(root)) {
      if (specifier === 'cloudflare:workers') {
        return { url: 'data:text/javascript,export class WorkflowEntrypoint {}', shortCircuit: true };
      }
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
        return nextResolve(specifier + '.ts', context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(root) && url.endsWith('.ts')) {
      return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
let worker;
try {
  worker = (await import('../cloudflare/edge-shield/src/index.ts')).default;
} finally {
  hooks.deregister();
}

test('Worker discovery responses do not access the origin or any platform bindings', async () => {
  let outbound = 0;
  let bindings = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { outbound++; throw new Error('unexpected outbound request'); };
  const env = new Proxy({}, { get() { bindings++; throw new Error('unexpected binding'); } });
  const ctx = new Proxy({}, { get() { bindings++; throw new Error('unexpected context access'); } });
  try {
    for (const path of ['ucp', 'oauth-authorization-server', 'api-catalog', 'http-message-signatures-directory', '%75cp///']) {
      for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
        const request = new Request('https://example.invalid/.well-known/' + path, { method });
        const res = await worker.fetch(request, env, ctx);
        assert.equal(res.status, 404, path + ' ' + method);
        assert.match(res.headers.get('content-type'), /^application\/json/);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.match(res.headers.get('x-robots-tag'), /noindex/);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(await res.text(), method === 'HEAD' ? '' : '{"error":"not_found"}');
      }
    }
    assert.equal(outbound, 0);
    assert.equal(bindings, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Worker health route remains operational', async () => {
  const res = await worker.fetch(new Request('https://example.invalid/__ultron/health'), { ENVIRONMENT: 'fixture' }, {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).environment, 'fixture');
});
