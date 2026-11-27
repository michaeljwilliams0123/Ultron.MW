import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createChromiumHostManifest } from './native-browser-transport.mjs';

const EXT = /^chrome-extension:\/\/[a-p]{32}\/$/;
const ID = /^[a-z0-9][a-z0-9_.:-]{2,79}$/i;
const HOST_NAME = 'com.ultron.browser';
const PATH_RE = /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]*$/;
const UNSAFE_CMD_CHARS = /[\x00-\x1f"&|<>^%]/;
const SPKI_PEM = /^-----BEGIN PUBLIC KEY-----\s+([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----\s*$/;

const pathOk = p => typeof p === 'string' && p.length <= 512 && PATH_RE.test(p) && !p.split('/').some(x => x === '.' || x === '..');
const validOrigin = o => { try { const u = new URL(o); return u.protocol === 'https:' && u.origin === o; } catch { return false; } };
const absPathOk = p => typeof p === 'string' && p.trim().length > 0 && !UNSAFE_CMD_CHARS.test(p) && (isAbsolute(p) || win32.isAbsolute(p));

function assertSpkiEd25519(pem) {
  if (typeof pem !== 'string' || pem.length > 512 || !SPKI_PEM.test(pem.trim())) {
    throw Error('native-host-enrollment-key-invalid');
  }
  const key = createPublicKey(pem);
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw Error('native-host-enrollment-key-invalid');
  }
  return key.export({ type: 'spki', format: 'pem' });
}

export function createHostIdentity({ hostId = 'ultron-local-browser' } = {}) {
  if (!ID.test(hostId || '')) throw Error('native-host-id-invalid');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const fingerprint = createHash('sha256').update(spkiDer).digest('hex');
  return Object.freeze({
    hostId,
    hostPublicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    hostPrivateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    fingerprint,
  });
}

export function buildWindowsHostWrapper({ nodeExecutable = process.execPath, hostScriptPath } = {}) {
  if (!absPathOk(nodeExecutable) || !absPathOk(hostScriptPath) || !/\.mjs$/i.test(hostScriptPath)) {
    throw Error('native-host-wrapper-path-invalid');
  }
  return `@echo off\r\n"${nodeExecutable}" "${hostScriptPath}" "%~1"\r\n`;
}

export function buildWindowsRegistryManifestPlan({ manifestPath, hostName = HOST_NAME } = {}) {
  if (!absPathOk(manifestPath) || !/\.json$/i.test(manifestPath) || hostName !== HOST_NAME) {
    throw Error('native-host-registry-plan-invalid');
  }
  return Object.freeze({
    hostName,
    chromeRegistryKey: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`,
    edgeRegistryKey: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${hostName}`,
    manifestPath,
    registeredByDefault: false,
  });
}

export function buildEnrollmentRecord({ hostId, deviceId, extensionOrigin, devicePublicKey, enrolledAt = new Date().toISOString() } = {}) {
  if (!ID.test(hostId || '') || !ID.test(deviceId || '') || !EXT.test(extensionOrigin || '')) {
    throw Error('native-host-enrollment-invalid');
  }
  const canonicalKey = assertSpkiEd25519(devicePublicKey);
  return Object.freeze({
    schema: 'ultron.native-browser.enrollment.v1',
    hostId,
    deviceId,
    extensionOrigin,
    devicePublicKey: canonicalKey,
    enrolledAt,
    revokedAt: null,
  });
}

function renderHostEntrypoint({ repoRoot }) {
  const transportUrl = pathToFileURL(join(repoRoot, 'src', 'computer', 'native-browser-transport.mjs')).href;
  const workerUrl = pathToFileURL(join(repoRoot, 'src', 'durable-web-read-worker.mjs')).href;
  const req = createRequire(join(repoRoot, 'package.json'));
  const pgliteUrl = pathToFileURL(req.resolve('@electric-sql/pglite')).href;
  return `import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from ${JSON.stringify(pgliteUrl)};
import { serveNativeBrowserPort } from ${JSON.stringify(transportUrl)};
import { createDurableWebReadWorker } from ${JSON.stringify(workerUrl)};

const dir = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(join(dir, 'host-config.json'), 'utf8'));
const hostPrivateKey = createPrivateKey(await readFile(join(dir, 'host-private.pem'), 'utf8'));
const enrollments = JSON.parse(await readFile(join(dir, 'enrollments.json'), 'utf8'));
const callerOrigin = process.argv[2] || '';
const active = enrollments.filter(e => e.hostId === config.hostId && e.extensionOrigin === config.extensionOrigin && e.revokedAt === null);
if (callerOrigin !== config.extensionOrigin || active.length === 0) {
  process.exitCode = 1;
  throw Error('native-host-enrollment-required');
}
const device = active[0];
const db = new PGlite(config.dbPath);
try {
  await db.exec(await readFile(config.migrationPath, 'utf8'));
  const binding = {
    id: config.bindingId,
    provider: 'playwright',
    runtime: 'local-node',
    actorRef: config.actorRef,
    authMethod: 'local-owner',
    origins: [config.origin],
    operations: [{ name: 'page.inspect', effect: 'read', scope: 'page.read' }],
    expiresAt: config.bindingExpiresAt,
    maxCostCents: 0,
    credentialRef: null,
  };
  const adapterModule = config.adapterModulePath ? await import(config.adapterModulePath) : null;
  const adapter = adapterModule?.createAdapter ? adapterModule.createAdapter(config) : {
    health: async () => ({ status: 'held', actorRef: config.actorRef, grantedScopes: [] }),
    execute: async () => { throw Error('native-host-browser-adapter-not-configured'); },
    observe: async () => ({ verified: false, origin: config.origin }),
    unbind: async () => ({ revoked: true }),
  };
  const worker = createDurableWebReadWorker({
    db,
    routes: [{ protocol: 'playwright', binding, adapter, allowedPaths: config.paths }],
    clock: () => new Date().toISOString(),
    authorizeRead: async () => config.authorizeRead === true,
  });
  await serveNativeBrowserPort({
    input: process.stdin,
    output: process.stdout,
    extensionOrigin: config.extensionOrigin,
    callerOrigin,
    hostId: config.hostId,
    deviceId: device.deviceId,
    devicePublicKey: device.devicePublicKey,
    hostPrivateKey,
    actorRef: config.actorRef,
    origin: config.origin,
    paths: config.paths,
    authorize: async () => config.authorizeRead === true,
    worker,
  });
} finally {
  await db.close();
}
`;
}

export async function packageNativeBrowserHost({
  targetDir,
  repoRoot,
  extensionOrigin,
  hostId = 'ultron-local-browser',
  actorRef = 'owner:ultron',
  origin = 'https://ultron-mw-cloud.hatchable.site',
  paths = ['/browser-write-acceptance.html'],
  nodeExecutable = process.execPath,
  bindingId = 'playwright-owner',
  bindingExpiresAt = '2027-12-31T00:00:00Z',
  authorizeRead = false,
  adapterModulePath = null,
} = {}) {
  if (!absPathOk(targetDir) || !absPathOk(repoRoot) || !EXT.test(extensionOrigin || '') ||
      !ID.test(hostId || '') || !ID.test(actorRef || '') || !validOrigin(origin) ||
      !Array.isArray(paths) || !paths.length || paths.length > 32 || paths.some(p => !pathOk(p))) {
    throw Error('native-host-package-config-invalid');
  }
  const dest = resolve(targetDir);
  await mkdir(dest);
  const identity = createHostIdentity({ hostId });
  const hostScriptPath = join(dest, 'ultron-native-host.mjs');
  const cmdPath = join(dest, 'ultron-native-host.cmd');
  const manifestPath = join(dest, `${HOST_NAME}.json`);
  const dbPath = join(dest, 'capability-attempts-pg');
  const migrationPath = join(repoRoot, 'cloud', 'hatchable', 'migrations', '0011_capability_attempts.sql');

  const manifest = createChromiumHostManifest({ extensionOrigin, executable: cmdPath });
  const cmdContent = buildWindowsHostWrapper({ nodeExecutable, hostScriptPath });
  const hostConfig = {
    schema: 'ultron.native-browser.host-config.v1',
    hostId: identity.hostId,
    extensionOrigin,
    actorRef,
    origin,
    paths,
    bindingId,
    bindingExpiresAt,
    authorizeRead: authorizeRead === true,
    adapterModulePath,
    dbPath,
    migrationPath,
    hostPublicKey: identity.hostPublicKey,
    fingerprint: identity.fingerprint,
  };
  const pairingInfo = Object.freeze({
    hostId: identity.hostId,
    extensionOrigin,
    hostPublicKey: identity.hostPublicKey,
    fingerprint: identity.fingerprint,
  });

  await writeFile(join(dest, 'host-config.json'), JSON.stringify(hostConfig, null, 2) + '\n', 'utf8');
  await writeFile(join(dest, 'host-private.pem'), identity.hostPrivateKeyPem, { encoding: 'utf8', mode: 0o600 });
  await writeFile(join(dest, 'enrollments.json'), '[]\n', 'utf8');
  await writeFile(join(dest, 'pairing-info.json'), JSON.stringify(pairingInfo, null, 2) + '\n', 'utf8');
  await writeFile(hostScriptPath, renderHostEntrypoint({ repoRoot }), 'utf8');
  await writeFile(cmdPath, cmdContent, 'utf8');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return Object.freeze({
    targetDir: dest,
    manifestPath,
    cmdPath,
    hostScriptPath,
    pairingInfo,
    registryPlan: buildWindowsRegistryManifestPlan({ manifestPath }),
  });
}

export async function enrollNativeDevice({ targetDir, enrollment, clock = () => new Date().toISOString() } = {}) {
  if (!absPathOk(targetDir)) throw Error('native-host-package-dir-invalid');
  const dest = resolve(targetDir);
  const config = JSON.parse(await readFile(join(dest, 'host-config.json'), 'utf8'));
  const parsed = typeof enrollment === 'string' ? JSON.parse(enrollment) : enrollment;
  if (!parsed || parsed.hostId !== config.hostId || parsed.extensionOrigin !== config.extensionOrigin) {
    throw Error('native-host-enrollment-mismatch');
  }
  const record = buildEnrollmentRecord({
    hostId: parsed.hostId,
    deviceId: parsed.deviceId,
    extensionOrigin: parsed.extensionOrigin,
    devicePublicKey: parsed.devicePublicKey,
    enrolledAt: clock(),
  });
  const enrollmentsPath = join(dest, 'enrollments.json');
  const existing = JSON.parse(await readFile(enrollmentsPath, 'utf8'));
  if (existing.some(e => e.deviceId === record.deviceId)) {
    throw Error('native-host-device-already-enrolled');
  }
  existing.push(record);
  await writeFile(enrollmentsPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  return record;
}
