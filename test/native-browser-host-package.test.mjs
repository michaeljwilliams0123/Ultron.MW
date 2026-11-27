import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { encodeNativeFrame, readNativeFrame } from '../src/computer/native-browser-transport.mjs';
import { createNativeBrowserClient } from '../src/computer/native-browser-client.mjs';
import { createLocalPairing, publicEnrollment, canaryTask } from '../browser-extension/ultron-native/pairing.mjs';
import {
  packageNativeBrowserHost,
  enrollNativeDevice,
  revokeNativeDevice,
  buildWindowsHostWrapper,
  buildWindowsRegistryManifestPlan,
  createHostAuthorizer,
  verifyHostPackageIntegrity,
  verifyWindowsAcl,
  validateEnrollmentList,
} from '../src/computer/native-browser-host-package.mjs';
import { createPlaywrightReadAdapter } from '../src/computer/native-browser-playwright-adapter.mjs';

const execFileAsync = promisify(execFile);

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const extensionOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';

test('packaging generates valid Windows wrapper, Chromium manifest, and non-mutating registry plan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ultron-host-pkg-'));
  const targetDir = join(dir, 'pkg');
  try {
    const pkg = await packageNativeBrowserHost({ targetDir, repoRoot, extensionOrigin });
    const manifest = JSON.parse(await readFile(pkg.manifestPath, 'utf8'));
    assert.equal(manifest.name, 'com.ultron.browser');
    assert.equal(manifest.type, 'stdio');
    assert.equal(manifest.path, pkg.cmdPath);
    assert.deepEqual(manifest.allowed_origins, [extensionOrigin]);
    const cmd = await readFile(pkg.cmdPath, 'utf8');
    assert.match(cmd, /^@echo off\r\n/);
    assert.ok(cmd.includes('"%~1"'));
    assert.equal(pkg.registryPlan.registeredByDefault, false);
    assert.equal(pkg.registryPlan.chromeRegistryKey, 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.ultron.browser');
    assert.throws(() => buildWindowsHostWrapper({ nodeExecutable: 'C:\\node.exe&calc', hostScriptPath: 'C:\\host.mjs' }));
    assert.throws(() => buildWindowsRegistryManifestPlan({ manifestPath: 'relative.json' }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('packaged Windows .cmd host completes authenticated PGlite exchange with PR #566 pairing and blocks unenrolled/foreign callers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ultron-host-e2e-'));
  const targetDir = join(dir, 'pkg');
  const marker = join(dir, 'dispatches.txt');
  const adapterFile = join(dir, 'test-adapter.mjs');
  try {
    await writeFile(
      adapterFile,
      [
        "import { appendFile } from 'node:fs/promises';",
        'export function createAdapter(config) {',
        '  return {',
        "    health: async () => ({ status: 'ready', actorRef: config.actorRef, grantedScopes: ['page.read'] }),",
        `    execute: async () => { await appendFile(${JSON.stringify(marker)}, 'dispatch\\n'); return { headingCount: 1 }; },`,
        '    observe: async () => ({ verified: true, origin: config.origin }),',
        '    unbind: async () => ({ revoked: true }),',
        '  };',
        '}',
      ].join('\n'),
      'utf8',
    );

    const pkg = await packageNativeBrowserHost({
      targetDir,
      repoRoot,
      extensionOrigin,
      authorizeRead: true,
      adapterModulePath: pathToFileURL(adapterFile).href,
      allowUnverifiedTestAdapter: true,
    });

    const pairing = await createLocalPairing(pkg.pairingInfo);
    const enrollment = publicEnrollment(pairing);
    const task = canaryTask(pairing);

    // Before enrollment, the packaged host must refuse execution.
    async function runPackagedHost(originArg, clientForRun) {
      const isWin = process.platform === 'win32';
      const child = isWin
        ? spawn(`"${pkg.cmdPath}"`, [originArg], { shell: true, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
        : spawn(process.execPath, [pkg.hostScriptPath, originArg], { stdio: ['pipe', 'pipe', 'pipe'] });
      const done = once(child, 'close');
      let stderr = '';
      child.stderr.on('data', b => { stderr += b.toString(); });
      try {
        if (!clientForRun) {
          const [code] = await done;
          return { code, stderr };
        }
        const challenge = await readNativeFrame(child.stdout).catch(async err => {
          await done;
          throw Error(`${err.message} (stderr: ${stderr})`);
        });
        const signedReq = await clientForRun.signRead(challenge, task);
        child.stdin.end(encodeNativeFrame(signedReq));
        const receiptFrame = await readNativeFrame(child.stdout);
        const verified = await clientForRun.verifyReceipt(receiptFrame);
        const [code] = await done;
        assert.equal(code, 0, stderr);
        return verified;
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
          await done;
        }
      }
    }

    const unenrolled = await runPackagedHost(extensionOrigin, null);
    assert.notEqual(unenrolled.code, 0);

    // Enroll device and verify duplicate enrollment is rejected.
    const enrolled = await enrollNativeDevice({ targetDir, enrollment });
    assert.equal(enrolled.deviceId, pairing.deviceId);
    await assert.rejects(enrollNativeDevice({ targetDir, enrollment }), /already-enrolled/);

    // Wrong caller origin must fail closed.
    const wrongOrigin = await runPackagedHost('chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/', null);
    assert.notEqual(wrongOrigin.code, 0);

    // First authenticated exchange dispatches once.
    const client1 = createNativeBrowserClient({
      hostId: pairing.hostId,
      deviceId: pairing.deviceId,
      extensionOrigin: pairing.extensionOrigin,
      hostPublicKey: pairing.hostPublicKey,
      devicePrivateKey: pairing.devicePrivateKey,
      authorize: async () => true,
    });
    const r1 = await runPackagedHost(extensionOrigin, client1);
    assert.equal(r1.status, 'completed');
    assert.equal(r1.receipt.resumed, false);

    // Second exchange with same idempotencyKey resumes from PGlite without a second dispatch.
    const client2 = createNativeBrowserClient({
      hostId: pairing.hostId,
      deviceId: pairing.deviceId,
      extensionOrigin: pairing.extensionOrigin,
      hostPublicKey: pairing.hostPublicKey,
      devicePrivateKey: pairing.devicePrivateKey,
      authorize: async () => true,
    });
    const r2 = await runPackagedHost(extensionOrigin, client2);
    assert.equal(r2.status, 'completed');
    assert.equal(r2.receipt.resumed, true);
    assert.equal(r2.receipt.resultDigest, r1.receipt.resultDigest);
    assert.equal(await readFile(marker, 'utf8'), 'dispatch\n');

    const db = new PGlite(join(targetDir, 'capability-attempts-pg'));
    try {
      const { rows } = await db.query('SELECT status, receipt FROM capability_attempts');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, 'completed');
      assert.equal(JSON.stringify(rows).includes('headingCount'), false);
    } finally {
      await db.close();
    }

    // Live device revocation must immediately block subsequent host invocations.
    const revoked = await revokeNativeDevice({ targetDir, deviceId: pairing.deviceId, reason: 'lost-device' });
    assert.ok(revoked.revokedAt);
    assert.equal(revoked.revokedReason, 'lost-device');
    await assert.rejects(revokeNativeDevice({ targetDir, deviceId: pairing.deviceId }), /not-found-or-revoked/);
    const afterRevoke = await runPackagedHost(extensionOrigin, null);
    assert.notEqual(afterRevoke.code, 0);
    assert.equal(await readFile(marker, 'utf8'), 'dispatch\n');

    if (process.platform === 'win32') {
      const { stdout: aclOut } = await execFileAsync('icacls.exe', [pkg.privateKeyPath], { windowsHide: true });
      assert.equal(aclOut.includes('BUILTIN\\Users'), false);
      assert.equal(aclOut.includes('Everyone'), false);
      assert.ok(aclOut.toLowerCase().includes((process.env.USERNAME || '').toLowerCase()));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('bounded Playwright read adapter fails closed when unavailable and enforces $0 read-only origin/path bounds', async () => {
  const missing = createPlaywrightReadAdapter({
    origin: 'https://ultron-mw-cloud.hatchable.site',
    loadPlaywright: async () => { throw Error('not-installed'); },
  });
  assert.equal((await missing.health()).status, 'held');
  await assert.rejects(missing.execute({
    operation: 'page.inspect',
    estimatedCostCents: 0,
    input: { url: 'https://ultron-mw-cloud.hatchable.site/browser-write-acceptance.html' },
  }), /playwright-unavailable/);

  let closed = false;
  const mockAdapter = createPlaywrightReadAdapter({
    origin: 'https://ultron-mw-cloud.hatchable.site',
    allowedPaths: ['/browser-write-acceptance.html'],
    loadPlaywright: async () => ({
      chromium: {
        launch: async () => ({
          newContext: async () => ({
            route: async () => {},
            newPage: async () => ({
              setDefaultTimeout() {},
              async goto() {},
              url: () => 'https://ultron-mw-cloud.hatchable.site/browser-write-acceptance.html',
              evaluate: async () => ({ title: 'Ultron Acceptance', headingCount: 1 }),
            }),
          }),
          close: async () => { closed = true; },
        }),
      },
    }),
  });
  assert.equal((await mockAdapter.health()).status, 'ready');
  await assert.rejects(mockAdapter.execute({
    operation: 'page.inspect',
    estimatedCostCents: 10,
    input: { url: 'https://ultron-mw-cloud.hatchable.site/browser-write-acceptance.html' },
  }), /request-invalid/);
  await assert.rejects(mockAdapter.execute({
    operation: 'page.inspect',
    estimatedCostCents: 0,
    input: { url: 'https://ultron-mw-cloud.hatchable.site/other.html' },
  }), /path-denied/);
  const data = await mockAdapter.execute({
    operation: 'page.inspect',
    estimatedCostCents: 0,
    input: { url: 'https://ultron-mw-cloud.hatchable.site/browser-write-acceptance.html' },
  });
  assert.deepEqual(data, {
    url: 'https://ultron-mw-cloud.hatchable.site/browser-write-acceptance.html',
    status: 200,
    contentType: 'text/html',
    title: 'Ultron Acceptance',
    headingCount: 1,
  });
  assert.equal(closed, true);
  assert.deepEqual(await mockAdapter.observe({ query: { resultDigest: createHash('sha256').update(JSON.stringify(data)).digest('hex') } }), {
    verified: true,
    origin: 'https://ultron-mw-cloud.hatchable.site',
  });
  assert.deepEqual(await mockAdapter.unbind(), { revoked: true });
});

test('Playwright observation rejects unrelated digests and stale success after failure',async()=>{
 const {createHash}=await import('node:crypto');
 const origin='https://ultron-mw-cloud.hatchable.site',path='/browser-write-acceptance.html';
 let fail=false;
 const a=createPlaywrightReadAdapter({origin,allowedPaths:[path],loadPlaywright:async()=>({chromium:{launch:async()=>({newContext:async()=>({route:async()=>{},newPage:async()=>({setDefaultTimeout(){},async goto(){if(fail)throw Error('fixture-failure')},url:()=>origin+path,evaluate:async()=>({title:'fixture',headingCount:1})})}),close:async()=>{}})}})});
 const task={operation:'page.inspect',estimatedCostCents:0,input:{url:origin+path}};
 const result=await a.execute(task);
 const digest=createHash('sha256').update(JSON.stringify(result)).digest('hex');
 assert.equal((await a.observe({query:{resultDigest:'f'.repeat(64)}})).verified,false);
 assert.equal((await a.observe({query:{resultDigest:digest}})).verified,true);
 fail=true;await assert.rejects(a.execute(task),/fixture-failure/);
 assert.equal((await a.observe({query:{resultDigest:digest}})).verified,false);
});

test('Playwright read adapter rejects unapproved URL components and final paths before extraction',async()=>{
 const origin='https://ultron-mw-cloud.hatchable.site',path='/browser-write-acceptance.html';
 let extracted=0,navigated=0;
 const a=createPlaywrightReadAdapter({origin,allowedPaths:[path],loadPlaywright:async()=>({chromium:{launch:async()=>({newContext:async()=>({route:async()=>{},newPage:async()=>({setDefaultTimeout(){},async goto(){navigated++},url:()=>origin+'/not-admitted.html',evaluate:async()=>{extracted++;return{title:'fixture',headingCount:1}}})}),close:async()=>{}})}})});
 const run=url=>a.execute({operation:'page.inspect',estimatedCostCents:0,input:{url}});
 await assert.rejects(run(origin+path+'?unapproved=1'),/path-denied/);
 assert.equal(navigated,0);
 await assert.rejects(run(origin+path),/redirect-denied/);
 assert.equal(extracted,0);
});

test('Playwright adapter rejects HTTP 401/403/404/429/500/503, redirects, non-HTML, error titles, and missing marker', async () => {
  const origin = 'https://ultron-mw-cloud.hatchable.site';
  const path = '/browser-write-acceptance.html';
  const makeRouteAdapter = (status, headers = { 'content-type': 'text/html; charset=utf-8' }, title = 'Ultron Acceptance', textSample = 'ULTRON-ACCEPTANCE-OK', requiredMarker = null) =>
    createPlaywrightReadAdapter({
      origin,
      allowedPaths: [path],
      requiredMarker,
      loadPlaywright: async () => ({
        chromium: {
          launch: async () => ({
            newContext: async () => {
              let handler;
              return {
                route: async (_pat, fn) => { handler = fn; },
                newPage: async () => ({
                  setDefaultTimeout() {},
                  async goto(url) {
                    let aborted = false;
                    let fulfilled = null;
                    await handler({
                      request: () => ({ method: () => 'GET', isNavigationRequest: () => true, url: () => url }),
                      fetch: async () => ({ status: () => status, headers: () => headers }),
                      abort: async () => { aborted = true; },
                      fulfill: async ({ response }) => { fulfilled = response; },
                    });
                    if (aborted) throw Error('net::ERR_FAILED');
                    return fulfilled;
                  },
                  url: () => origin + path,
                  evaluate: async () => ({ title, headingCount: 1, textSample }),
                }),
              };
            },
            close: async () => {},
          }),
        },
      }),
    });

  const task = { operation: 'page.inspect', estimatedCostCents: 0, input: { url: origin + path } };
  for (const code of [302, 401, 403, 404, 429, 500, 503]) {
    const adapter = makeRouteAdapter(code);
    await assert.rejects(adapter.execute(task), code === 302 ? /redirect-denied/ : new RegExp(`http-status-${code}`));
  }
  await assert.rejects(makeRouteAdapter(200, { 'content-type': 'application/json' }).execute(task), /content-type-denied/);
  await assert.rejects(makeRouteAdapter(200, { 'content-type': 'text/plain' }).execute(task), /content-type-denied/);
  await assert.rejects(makeRouteAdapter(200, { 'content-type': 'text/html' }, 'Temporarily unavailable').execute(task), /error-document-denied/);
  await assert.rejects(makeRouteAdapter(200, { 'content-type': 'text/html' }, 'Ultron Acceptance', 'wrong body', 'ULTRON-ACCEPTANCE-OK').execute(task), /acceptance-marker-missing/);
  const ok = await makeRouteAdapter(200, { 'content-type': 'text/html; charset=utf-8' }, 'Ultron Acceptance', 'ULTRON-ACCEPTANCE-OK', 'ULTRON-ACCEPTANCE-OK').execute(task);
  assert.equal(ok.status, 200);
  assert.equal(ok.contentType, 'text/html');
});

test('in-flight revocation, atomic enrollment locking, and host package integrity fail closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ultron-host-sec-'));
  const targetDir = join(dir, 'pkg');
  try {
    await assert.rejects(
      packageNativeBrowserHost({ targetDir: join(dir, 'denied'), repoRoot, extensionOrigin, adapterModulePath: 'file:///evil.mjs' }),
      /unverified-adapter-denied/,
    );
    await assert.rejects(
      packageNativeBrowserHost({ targetDir: join(dir, 'prod-denied'), repoRoot, extensionOrigin, adapterModulePath: 'file:///evil.mjs', allowUnverifiedTestAdapter: true, productionMode: true }),
      /unverified-adapter-denied/,
    );

    const pkg = await packageNativeBrowserHost({ targetDir, repoRoot, extensionOrigin, authorizeRead: true });
    assert.equal((await verifyHostPackageIntegrity({ targetDir })).verified, true);
    if (process.platform === 'win32') {
      assert.equal((await verifyWindowsAcl({ targetPath: targetDir })).verified, true);
      assert.equal((await verifyWindowsAcl({ targetPath: pkg.privateKeyPath })).verified, true);
    }

    const pairing1 = await createLocalPairing(pkg.pairingInfo);
    const pairing2 = await createLocalPairing(pkg.pairingInfo);
    // Concurrent enroll: single active device policy ensures only one succeeds.
    const results = await Promise.allSettled([
      enrollNativeDevice({ targetDir, enrollment: publicEnrollment(pairing1) }),
      enrollNativeDevice({ targetDir, enrollment: publicEnrollment(pairing2) }),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);

    const active = validateEnrollmentList(JSON.parse(await readFile(join(targetDir, 'enrollments.json'), 'utf8'))).find(e => e.revokedAt === null);
    const authorizer = await createHostAuthorizer({
      targetDir,
      hostId: active.hostId,
      extensionOrigin: active.extensionOrigin,
      deviceId: active.deviceId,
      devicePublicKey: active.devicePublicKey,
    });
    assert.equal(await authorizer.verifyActive(), true);

    // Simulate revocation during dispatch: must return reconcile-required, never completed.
    const wrapped = authorizer.wrapWorker({
      async execute(t) {
        await revokeNativeDevice({ targetDir, deviceId: active.deviceId, reason: 'inflight-revoke' });
        return { status: 'completed', bindingId: 'playwright-owner', actorRef: t.actorRef, operation: t.operation, effect: 'read', costCents: 0, idempotencyKey: t.idempotencyKey, resultDigest: 'a'.repeat(64) };
      },
    });
    const inflightOutcome = await wrapped.execute({ idempotencyKey: 'read:inflight-001' });
    assert.equal(inflightOutcome.status, 'reconcile-required');
    assert.equal(await authorizer.verifyActive(), false);

    // Re-enrolling a previously revoked deviceId must be rejected.
    await assert.rejects(enrollNativeDevice({ targetDir, enrollment: { ...publicEnrollment(pairing1), deviceId: active.deviceId, devicePublicKey: active.devicePublicKey } }), /already-enrolled/);

    // Held lock fails closed.
    await writeFile(join(targetDir, 'enrollments.lock'), '{"pid":99999}', 'utf8');
    await assert.rejects(enrollNativeDevice({ targetDir, enrollment: publicEnrollment(pairing2) }), /lock-unavailable/);

    // Tampered host-config.json fails integrity verification.
    await writeFile(join(targetDir, 'host-config.json'), '{"tampered":true}\n', 'utf8');
    await assert.rejects(verifyHostPackageIntegrity({ targetDir }), /integrity-tampered:host-config\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
