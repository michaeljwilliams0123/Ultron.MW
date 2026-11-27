import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { encodeNativeFrame, readNativeFrame } from '../src/computer/native-browser-transport.mjs';
import { createNativeBrowserClient } from '../src/computer/native-browser-client.mjs';
import { createLocalPairing, publicEnrollment, canaryTask } from '../browser-extension/ultron-native/pairing.mjs';
import {
  packageNativeBrowserHost,
  enrollNativeDevice,
  buildWindowsHostWrapper,
  buildWindowsRegistryManifestPlan,
} from '../src/computer/native-browser-host-package.mjs';

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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
