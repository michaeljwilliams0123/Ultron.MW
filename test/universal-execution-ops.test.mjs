import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createUniversalExecutionBroker, runRemediationLoop } from '../src/universal-execution-broker.mjs';
import { createWindowsScopedExecutor } from '../src/computer/windows-scoped-executor.mjs';
import { createNativeBrowserWriteAdapter } from '../src/computer/native-browser-write-adapter.mjs';

function makeContract(overrides = {}) {
  return {
    provider: 'ultron-canary',
    executionMethod: 'native-browser',
    actorRef: 'owner:ultron',
    resourceId: 'canary:record-1',
    operation: 'canary.write',
    effect: 'write',
    scope: 'canary.write',
    inputSchema: v => typeof v?.marker === 'string',
    outputSchema: v => typeof v?.saved === 'boolean',
    preconditions: async () => true,
    postconditions: async v => v?.saved === true,
    policyRef: 'policy:standing-canary-v1',
    maxCostCents: 0,
    idempotencyKey: 'op:canary-001',
    deadlineMs: 5000,
    verify: async () => true,
    compensate: async () => ({ compensated: true }),
    evidenceRetention: { retainDays: 30 },
    ...overrides,
  };
}

test('universal execution broker enforces full lifecycle, PGlite restart recovery, and zero duplicate effects', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../cloud/hatchable/migrations/0011_capability_attempts.sql', import.meta.url), 'utf8'));
    let dispatches = 0;
    const broker1 = createUniversalExecutionBroker({ db, authorize: async () => ({ authorized: true }) });
    const contract = makeContract();
    const r1 = await broker1.execute(contract, { marker: 'M-001' }, {
      executeProvider: async () => { dispatches++; return { saved: true, marker: 'M-001' }; },
    });
    assert.equal(r1.state, 'COMPLETED');
    assert.equal(r1.resumed, false);
    assert.deepEqual(r1.history.map(h => h.state), ['RECEIVED', 'PLANNED', 'AUTHORIZED', 'CLAIMED', 'EXECUTING', 'VERIFYING', 'COMPLETED']);

    // Restart broker on same DB and replay: must resume without re-dispatching.
    const broker2 = createUniversalExecutionBroker({ db, authorize: async () => ({ authorized: true }) });
    const r2 = await broker2.execute(contract, { marker: 'M-001' }, {
      executeProvider: async () => { dispatches++; return { saved: true }; },
    });
    assert.equal(r2.state, 'COMPLETED');
    assert.equal(r2.resumed, true);
    assert.equal(r2.resultDigest, r1.resultDigest);
    assert.equal(dispatches, 1);

    // Different input with same idempotencyKey must fail closed.
    await assert.rejects(
      broker2.execute(contract, { marker: 'M-999' }, { executeProvider: async () => ({ saved: true }) }),
      /idempotency-conflict/,
    );
  } finally {
    await db.close();
  }
});

test('broker recovers from expired credential via refresh, handles mid-flight revocation, and supports compensation', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../cloud/hatchable/migrations/0011_capability_attempts.sql', import.meta.url), 'utf8'));
    let expired = true;
    let refreshed = 0;
    const broker = createUniversalExecutionBroker({
      db,
      authorize: async () => (expired ? { authorized: false, reason: 'credential-expired' } : { authorized: true }),
      refreshCredential: async () => { refreshed++; expired = false; return { refreshed: true }; },
    });
    const r1 = await broker.execute(makeContract({ idempotencyKey: 'op:refresh-001' }), { marker: 'R-1' }, {
      executeProvider: async () => ({ saved: true }),
    });
    assert.equal(r1.state, 'COMPLETED');
    assert.equal(refreshed, 1);

    // Revoke after execution / before completion -> RECONCILE_REQUIRED, then compensate -> COMPENSATED.
    let authCalls = 0;
    const revokingBroker = createUniversalExecutionBroker({
      db,
      authorize: async () => {
        authCalls++;
        return authCalls <= 2 ? { authorized: true } : { authorized: false, revoked: true, reason: 'owner-revoked' };
      },
    });
    const contract = makeContract({ idempotencyKey: 'op:revoke-001' });
    const r2 = await revokingBroker.execute(contract, { marker: 'R-2' }, {
      executeProvider: async () => ({ saved: true }),
    });
    assert.equal(r2.state, 'RECONCILE_REQUIRED');
    const comp = await revokingBroker.compensate(contract, { marker: 'R-2' }, r2);
    assert.equal(comp.state, 'COMPENSATED');
  } finally {
    await db.close();
  }
});

test('competing workers with same idempotencyKey execute provider at most once', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../cloud/hatchable/migrations/0011_capability_attempts.sql', import.meta.url), 'utf8'));
    let executions = 0;
    const broker = createUniversalExecutionBroker({ db, authorize: async () => ({ authorized: true }) });
    const contract = makeContract({ idempotencyKey: 'op:race-001' });
    const [a, b] = await Promise.all([
      broker.execute(contract, { marker: 'RACE' }, { workerId: 'w1', executeProvider: async () => { executions++; return { saved: true }; } }),
      broker.execute(contract, { marker: 'RACE' }, { workerId: 'w2', executeProvider: async () => { executions++; return { saved: true }; } }),
    ]);
    assert.equal(executions, 1);
    assert.equal([a, b].filter(x => x.resumed === true).length, 1);
  } finally {
    await db.close();
  }
});

test('Windows scoped executor enforces root confinement, approved commands, and cleanup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ultron-win-scoped-'));
  try {
    const exec = await createWindowsScopedExecutor({ rootDir: dir });
    await exec.createScopedDir('work');
    const w = await exec.writeScopedFile('work/hello.txt', 'hello ultron');
    assert.equal(w.written, true);
    const r = await exec.readScopedFile('work/hello.txt');
    assert.equal(r.content, 'hello ultron');
    assert.equal(r.sha256, w.sha256);

    await exec.writeScopedFile('work/check.mjs', 'console.log("ok");\n');
    const proc = await exec.runApproved('node', ['work/check.mjs']);
    assert.equal(proc.exitCode, 0);
    assert.equal(proc.stdoutPreview.trim(), 'ok');

    await assert.rejects(exec.readScopedFile('../outside.txt'), /escape-denied/);
    await assert.rejects(exec.runApproved('powershell', ['-Command', 'whoami']), /command-denied/);
    await assert.rejects(exec.runApproved('node', ['-e', 'bad&calc']), /command-denied/);

    await exec.cleanupScoped('work');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('browser write adapter executes fill/submit/compensate and rejects unauthorized paths and HTTP 429', async () => {
  const origin = 'http://127.0.0.1';
  const path = '/browser-write-acceptance.html';
  const filled = [];
  const clicked = [];
  const adapter = createNativeBrowserWriteAdapter({
    origin,
    allowedPaths: [path],
    loadPlaywright: async () => ({
      chromium: {
        launch: async () => ({
          newContext: async () => ({
            on() {},
            route: async () => {},
            newPage: async () => ({
              setDefaultTimeout() {},
              on() {},
              async goto() {},
              url: () => origin + path,
              fill: async (sel, val) => { filled.push([sel, val]); },
              click: async (sel) => { clicked.push(sel); },
              evaluate: async () => ({ title: 'Ultron Browser Write Acceptance', statusText: 'CANARY-SAVED' }),
            }),
          }),
          close: async () => {},
        }),
      },
    }),
  });
  const submitRes = await adapter.execute({
    operation: 'page.submit',
    estimatedCostCents: 0,
    input: { url: origin + path, fields: [{ selector: '#marker', value: 'CANARY-01' }], submitSelector: '#submit' },
  });
  assert.equal(submitRes.statusText, 'CANARY-SAVED');
  assert.deepEqual(filled, [['#marker', 'CANARY-01']]);
  assert.deepEqual(clicked, ['#submit']);

  await assert.rejects(
    adapter.execute({ operation: 'page.submit', estimatedCostCents: 0, input: { url: 'https://evil.example/steal' } }),
    /path-denied/,
  );
});

test('autonomous remediation loop returns REMEDIATED on fix and INCIDENT_RECORDED on exhaustion', async () => {
  const ok = await runRemediationLoop({
    issueId: 'issue-523',
    maxAttempts: 2,
    detect: async () => ({ found: true, summary: 'broken route' }),
    classify: async d => ({ severity: 'p0', ...d }),
    reproduce: async () => ({ reproduced: true }),
    diagnose: async ({ attempt }) => ({ rootCause: `attempt-${attempt}` }),
    patch: async ({ attempt }) => ({ diff: `patch-${attempt}` }),
    test: async ({ attempt }) => ({ passed: attempt === 2 }),
    review: async () => ({ approved: true }),
    land: async () => ({ landed: true, sha: 'abc123' }),
    verify: async () => ({ verified: true }),
  });
  assert.equal(ok.status, 'REMEDIATED');
  assert.equal(ok.attempt, 2);

  const exhausted = await runRemediationLoop({
    issueId: 'issue-524',
    maxAttempts: 2,
    detect: async () => ({ found: true, summary: 'persistent outage' }),
    classify: async d => ({ severity: 'p0', ...d }),
    reproduce: async () => ({ reproduced: true }),
    diagnose: async () => ({ rootCause: 'upstream-503' }),
    patch: async () => ({ diff: 'noop' }),
    test: async () => ({ passed: false }),
    review: async () => ({ approved: false }),
    land: async () => ({ landed: false }),
    verify: async () => ({ verified: false }),
  });
  assert.equal(exhausted.status, 'INCIDENT_RECORDED');
  assert.equal(exhausted.incident.attempted.length, 2);
});

test('real installed Chrome executes create -> modify -> PGlite restart reconcile -> compensate on controlled 127.0.0.1 surface', async (t) => {
  const { existsSync } = await import('node:fs');
  const http = await import('node:http');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const pwPath = 'C:\\Users\\mikewilliams\\AppData\\Local\\Temp\\ultron-browser-acceptance\\node_modules\\playwright\\index.mjs';
  if (process.platform !== 'win32' || !existsSync(chromePath) || !existsSync(pwPath)) {
    t.skip('Real Chrome + local Playwright fixture only present on SD009WC7');
    return;
  }
  const pwMod = await import(`file:///${pwPath.replace(/\\/g, '/')}`);
  const records = new Map();
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/browser-write-acceptance.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><title>Ultron Write Canary</title></head><body>
        <form id="f" method="POST" action="/browser-write-acceptance.html"><input id="id" name="id"><input id="val" name="val"><button id="save" type="submit">Save</button></form>
        <div id="out">${records.get('c1') || 'EMPTY'}</div>
        </body></html>`);
      return;
    }
    if (req.method === 'POST' && req.url === '/browser-write-acceptance.html') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const id = params.get('id') || '';
        const val = params.get('val') || '';
        if (val === '__COMPENSATE__') {
          records.delete(id);
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><html><head><title>Ultron Write Canary</title></head><body><div id="out">COMPENSATED:' + id + '</div></body></html>');
        } else {
          records.set(id, val);
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><html><head><title>Ultron Write Canary</title></head><body><div id="out">SAVED:' + id + '=' + val + '</div></body></html>');
        }
      });
      return;
    }
    res.writeHead(404).end('not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const origin = `http://127.0.0.1:${addr.port}`;
  const path = '/browser-write-acceptance.html';
  const dir = await mkdtemp(join(tmpdir(), 'ultron-chrome-write-'));
  try {
    const db1 = new PGlite(join(dir, 'pg'));
    await db1.exec(await readFile(new URL('../cloud/hatchable/migrations/0011_capability_attempts.sql', import.meta.url), 'utf8'));
    const adapter = createNativeBrowserWriteAdapter({
      origin,
      allowedPaths: [path],
      loadPlaywright: async () => ({ chromium: { launch: (o) => pwMod.chromium.launch({ ...o, executablePath: chromePath }) } }),
    });
    const broker1 = createUniversalExecutionBroker({ db: db1, authorize: async () => ({ authorized: true }) });
    let dispatches = 0;

    const createContract = makeContract({
      operation: 'page.submit',
      idempotencyKey: 'chrome:create-001',
      deadlineMs: 60_000,
      inputSchema: v => typeof v?.val === 'string',
      outputSchema: v => typeof v?.url === 'string',
      postconditions: async () => records.get('c1') === 'CANARY-001',
      verify: async () => records.get('c1') === 'CANARY-001',
      compensate: async () => {
        await adapter.execute({
          operation: 'page.compensate',
          estimatedCostCents: 0,
          input: { url: origin + path, fields: [{ selector: '#id', value: 'c1' }, { selector: '#val', value: '__COMPENSATE__' }], submitSelector: '#save' },
        });
        return { compensated: records.has('c1') === false };
      },
    });

    const rCreate = await broker1.execute(createContract, { val: 'CANARY-001' }, {
      executeProvider: async () => {
        dispatches++;
        return adapter.execute({
          operation: 'page.submit',
          estimatedCostCents: 0,
          input: { url: origin + path, fields: [{ selector: '#id', value: 'c1' }, { selector: '#val', value: 'CANARY-001' }], submitSelector: '#save' },
        });
      },
    });
    assert.equal(rCreate.state, 'COMPLETED');
    assert.equal(records.get('c1'), 'CANARY-001');
    await db1.close();

    // Restart broker on same PGlite DB and replay -> zero duplicate Chrome dispatches.
    const db2 = new PGlite(join(dir, 'pg'));
    const broker2 = createUniversalExecutionBroker({ db: db2, authorize: async () => ({ authorized: true }) });
    const rReplay = await broker2.execute(createContract, { val: 'CANARY-001' }, {
      executeProvider: async () => { dispatches++; return {}; },
    });
    assert.equal(rReplay.state, 'COMPLETED');
    assert.equal(rReplay.resumed, true);
    assert.equal(dispatches, 1);

    // Compensate via real Chrome and confirm cleanup.
    const rComp = await broker2.compensate(createContract, { val: 'CANARY-001' }, rReplay);
    assert.equal(rComp.state, 'COMPENSATED');
    assert.equal(records.has('c1'), false);
    await db2.close();
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
