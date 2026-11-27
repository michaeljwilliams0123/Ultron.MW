import { execFile } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createChromiumHostManifest } from './native-browser-transport.mjs';

const execFileAsync = promisify(execFile);

const EXT = /^chrome-extension:\/\/[a-p]{32}\/$/;
const ID = /^[a-z0-9][a-z0-9_.:-]{2,79}$/i;
const HOST_NAME = 'com.ultron.browser';
const PATH_RE = /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]*$/;
const UNSAFE_CMD_CHARS = /[\x00-\x1f"&|<>^%]/;
const SPKI_PEM = /^-----BEGIN PUBLIC KEY-----\s+([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----\s*$/;
const MAX_ENROLLMENTS = 64;

const pathOk = p => typeof p === 'string' && p.length <= 512 && PATH_RE.test(p) && !p.split('/').some(x => x === '.' || x === '..');
const validOrigin = o => { try { const u = new URL(o); return u.protocol === 'https:' && u.origin === o; } catch { return false; } };
const absPathOk = p => typeof p === 'string' && p.trim().length > 0 && !UNSAFE_CMD_CHARS.test(p) && (isAbsolute(p) || win32.isAbsolute(p));
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const sha256Hex = buf => createHash('sha256').update(buf).digest('hex');

const isPlainDataObject = v => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const d = Object.getOwnPropertyDescriptors(v);
  return Reflect.ownKeys(d).every(k => typeof k === 'string' && d[k]?.enumerable && Object.hasOwn(d[k], 'value'));
};

export async function assertNoSymlinkOrJunction(targetPath) {
  const resolved = resolve(targetPath);
  const st = await lstat(resolved);
  if (st.isSymbolicLink()) {
    throw Error('native-host-symlink-or-junction-denied');
  }
  const real = await realpath(resolved);
  const parentReal = await realpath(dirname(resolved));
  const expectedReal = join(parentReal, basename(resolved));
  if (!samePath(real, expectedReal)) {
    throw Error('native-host-reparse-path-denied');
  }
  return real;
}

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
  const fingerprint = sha256Hex(spkiDer);
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
  if (!ID.test(hostId || '') || !ID.test(deviceId || '') || !EXT.test(extensionOrigin || '') || typeof enrolledAt !== 'string' || Number.isNaN(Date.parse(enrolledAt))) {
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

export function validateEnrollmentList(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_ENROLLMENTS) {
    throw Error('native-host-enrollments-corrupt');
  }
  const seenIds = new Set();
  const seenKeys = new Set();
  const activePairs = new Set();
  return raw.map(entry => {
    if (!isPlainDataObject(entry) || entry.schema !== 'ultron.native-browser.enrollment.v1') {
      throw Error('native-host-enrollments-corrupt');
    }
    const base = buildEnrollmentRecord({
      hostId: entry.hostId,
      deviceId: entry.deviceId,
      extensionOrigin: entry.extensionOrigin,
      devicePublicKey: entry.devicePublicKey,
      enrolledAt: entry.enrolledAt,
    });
    if (seenIds.has(base.deviceId) || seenKeys.has(base.devicePublicKey)) {
      throw Error('native-host-enrollment-duplicate');
    }
    seenIds.add(base.deviceId);
    seenKeys.add(base.devicePublicKey);
    if (entry.revokedAt !== null) {
      if (typeof entry.revokedAt !== 'string' || Number.isNaN(Date.parse(entry.revokedAt))) {
        throw Error('native-host-enrollments-corrupt');
      }
      return Object.freeze({
        ...base,
        revokedAt: entry.revokedAt,
        ...(typeof entry.revokedReason === 'string' ? { revokedReason: entry.revokedReason.slice(0, 120) } : {}),
      });
    }
    const pairKey = `${base.hostId}\0${base.extensionOrigin}`;
    if (activePairs.has(pairKey)) {
      throw Error('native-host-enrollment-multiple-active');
    }
    activePairs.add(pairKey);
    return base;
  });
}

async function atomicWriteFile(filePath, content, { mode = 0o600 } = {}) {
  const tmpPath = `${filePath}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
  const fh = await open(tmpPath, 'wx', mode);
  try {
    await fh.writeFile(content, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmpPath, filePath);
}

async function withEnrollmentLock(dest, fn, { timeoutMs = 2000 } = {}) {
  const lockPath = join(dest, 'enrollments.lock');
  const deadline = Date.now() + timeoutMs;
  let fh = null;
  while (true) {
    try {
      fh = await open(lockPath, 'wx', 0o600);
      await fh.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), 'utf8');
      await fh.close();
      fh = null;
      break;
    } catch (err) {
      if (fh) { try { await fh.close(); } catch {} fh = null; }
      if (err?.code !== 'EEXIST' || Date.now() >= deadline) {
        throw Error('native-host-enrollment-lock-unavailable');
      }
      await new Promise(r => setTimeout(r, 25));
    }
  }
  try {
    return await fn();
  } finally {
    await unlink(lockPath).catch(() => {});
  }
}

export async function restrictDirectoryAcl({
  dirPath,
  platform = process.platform,
  username = process.env.USERNAME || '',
} = {}) {
  if (!absPathOk(dirPath)) throw Error('native-host-dir-path-invalid');
  if (platform === 'win32') {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) throw Error('native-host-acl-username-invalid');
    await execFileAsync('icacls.exe', [dirPath, '/inheritance:r', '/grant:r', `${username}:(OI)(CI)F`], { windowsHide: true });
    return Object.freeze({ platform, restricted: true, principal: username, permission: '(OI)(CI)F' });
  }
  await chmod(dirPath, 0o700);
  return Object.freeze({ platform, restricted: true, mode: '0700' });
}

export async function restrictPrivateKeyAcl({
  privateKeyPath,
  platform = process.platform,
  username = process.env.USERNAME || '',
} = {}) {
  if (!absPathOk(privateKeyPath)) throw Error('native-host-private-key-path-invalid');
  if (platform === 'win32') {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) throw Error('native-host-acl-username-invalid');
    await execFileAsync('icacls.exe', [privateKeyPath, '/inheritance:r', '/grant:r', `${username}:(R)`], { windowsHide: true });
    return Object.freeze({ platform, restricted: true, principal: username, permission: 'R' });
  }
  await chmod(privateKeyPath, 0o600);
  return Object.freeze({ platform, restricted: true, mode: '0600' });
}

export async function verifyWindowsAcl({
  targetPath,
  username = process.env.USERNAME || '',
} = {}) {
  if (process.platform !== 'win32') return Object.freeze({ platform: process.platform, verified: true });
  if (!absPathOk(targetPath) || !/^[a-zA-Z0-9._-]{1,64}$/.test(username)) throw Error('native-host-acl-verify-invalid');
  const { stdout } = await execFileAsync('icacls.exe', [targetPath], { windowsHide: true });
  const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^Successfully processed/i.test(l));
  const broad = /\b(Everyone|BUILTIN\\Users|NT AUTHORITY\\Authenticated Users|BUILTIN\\Guests)\b/i;
  if (lines.some(l => broad.test(l) || /\(I\)/.test(l))) {
    throw Error('native-host-acl-too-broad');
  }
  const hasOwner = lines.some(l => l.toLowerCase().includes(username.toLowerCase()));
  if (!hasOwner) throw Error('native-host-acl-owner-missing');
  return Object.freeze({ platform: 'win32', verified: true, principal: username });
}

function repoIntegrityFiles(repoRoot) {
  return [
    ['repo:native-browser-transport.mjs', join(repoRoot, 'src', 'computer', 'native-browser-transport.mjs')],
    ['repo:native-browser-client.mjs', join(repoRoot, 'src', 'computer', 'native-browser-client.mjs')],
    ['repo:durable-web-read-worker.mjs', join(repoRoot, 'src', 'durable-web-read-worker.mjs')],
    ['repo:native-browser-playwright-adapter.mjs', join(repoRoot, 'src', 'computer', 'native-browser-playwright-adapter.mjs')],
    ['repo:0011_capability_attempts.sql', join(repoRoot, 'cloud', 'hatchable', 'migrations', '0011_capability_attempts.sql')],
  ];
}

async function writeSignedIntegrityManifest({ dest, repoRoot, hostPrivateKey }) {
  const files = {};
  for (const name of ['host-config.json', 'pairing-info.json', 'ultron-native-host.mjs', 'ultron-native-host.cmd', `${HOST_NAME}.json`]) {
    const full = await assertNoSymlinkOrJunction(join(dest, name));
    files[`pkg:${name}`] = sha256Hex(await readFile(full));
  }
  for (const [label, fullPath] of repoIntegrityFiles(repoRoot)) {
    const full = await assertNoSymlinkOrJunction(fullPath);
    files[label] = sha256Hex(await readFile(full));
  }
  const manifestBody = {
    schema: 'ultron.native-browser.integrity.v1',
    repoRoot: resolve(repoRoot),
    files,
  };
  const json = JSON.stringify(manifestBody, null, 2) + '\n';
  const sig = sign(null, Buffer.from(json, 'utf8'), hostPrivateKey).toString('base64url');
  await atomicWriteFile(join(dest, 'integrity-manifest.json'), json, { mode: 0o600 });
  await atomicWriteFile(join(dest, 'integrity-manifest.sig'), sig + '\n', { mode: 0o600 });
  return manifestBody;
}

export async function verifyHostPackageIntegrity({ targetDir } = {}) {
  if (!absPathOk(targetDir)) throw Error('native-host-package-dir-invalid');
  const dest = await assertNoSymlinkOrJunction(targetDir);
  const pairingInfo = JSON.parse(await readFile(await assertNoSymlinkOrJunction(join(dest, 'pairing-info.json')), 'utf8'));
  const hostPubPem = assertSpkiEd25519(pairingInfo?.hostPublicKey);
  const hostPub = createPublicKey(hostPubPem);
  const fp = sha256Hex(hostPub.export({ type: 'spki', format: 'der' }));
  if (fp !== pairingInfo.fingerprint) throw Error('native-host-integrity-fingerprint-mismatch');

  const manifestRaw = await readFile(await assertNoSymlinkOrJunction(join(dest, 'integrity-manifest.json')), 'utf8');
  const sigRaw = (await readFile(await assertNoSymlinkOrJunction(join(dest, 'integrity-manifest.sig')), 'utf8')).trim();
  if (!verify(null, Buffer.from(manifestRaw, 'utf8'), hostPub, Buffer.from(sigRaw, 'base64url'))) {
    throw Error('native-host-integrity-signature-invalid');
  }
  const manifest = JSON.parse(manifestRaw);
  if (manifest?.schema !== 'ultron.native-browser.integrity.v1' || !isPlainDataObject(manifest.files)) {
    throw Error('native-host-integrity-manifest-invalid');
  }
  for (const name of ['host-config.json', 'pairing-info.json', 'ultron-native-host.mjs', 'ultron-native-host.cmd', `${HOST_NAME}.json`]) {
    const full = await assertNoSymlinkOrJunction(join(dest, name));
    if (sha256Hex(await readFile(full)) !== manifest.files[`pkg:${name}`]) {
      throw Error(`native-host-integrity-tampered:${name}`);
    }
  }
  for (const [label, fullPath] of repoIntegrityFiles(manifest.repoRoot)) {
    const full = await assertNoSymlinkOrJunction(fullPath);
    if (sha256Hex(await readFile(full)) !== manifest.files[label]) {
      throw Error(`native-host-integrity-tampered:${label}`);
    }
  }
  return Object.freeze({ verified: true, targetDir: dest, fingerprint: fp });
}

export async function createHostAuthorizer({ targetDir, hostId, extensionOrigin, deviceId, devicePublicKey } = {}) {
  const canonicalDeviceKey = assertSpkiEd25519(devicePublicKey);
  const verifyActive = async () => {
    try {
      const dest = await assertNoSymlinkOrJunction(targetDir);
      const config = JSON.parse(await readFile(await assertNoSymlinkOrJunction(join(dest, 'host-config.json')), 'utf8'));
      if (config.authorizeRead !== true || config.hostId !== hostId || config.extensionOrigin !== extensionOrigin) {
        return false;
      }
      const rawEnrollments = JSON.parse(await readFile(await assertNoSymlinkOrJunction(join(dest, 'enrollments.json')), 'utf8'));
      const enrollments = validateEnrollmentList(rawEnrollments);
      return enrollments.some(e =>
        e.revokedAt === null &&
        e.hostId === hostId &&
        e.extensionOrigin === extensionOrigin &&
        e.deviceId === deviceId &&
        e.devicePublicKey === canonicalDeviceKey
      );
    } catch {
      return false;
    }
  };
  return Object.freeze({
    verifyActive,
    wrapWorker(worker) {
      return Object.freeze({
        async execute(task) {
          if (!(await verifyActive())) {
            return { status: 'held', idempotencyKey: task.idempotencyKey };
          }
          const result = await worker.execute(task);
          if (!(await verifyActive())) {
            return result?.status === 'completed'
              ? { status: 'reconcile-required', idempotencyKey: task.idempotencyKey }
              : { status: 'held', idempotencyKey: task.idempotencyKey };
          }
          return result;
        },
      });
    },
  });
}

function renderHostEntrypoint({ repoRoot }) {
  const transportUrl = pathToFileURL(join(repoRoot, 'src', 'computer', 'native-browser-transport.mjs')).href;
  const workerUrl = pathToFileURL(join(repoRoot, 'src', 'durable-web-read-worker.mjs')).href;
  const playwrightAdapterUrl = pathToFileURL(join(repoRoot, 'src', 'computer', 'native-browser-playwright-adapter.mjs')).href;
  const packageUrl = pathToFileURL(join(repoRoot, 'src', 'computer', 'native-browser-host-package.mjs')).href;
  const req = createRequire(join(repoRoot, 'package.json'));
  const pgliteUrl = pathToFileURL(req.resolve('@electric-sql/pglite')).href;
  return `import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from ${JSON.stringify(pgliteUrl)};
import { serveNativeBrowserPort } from ${JSON.stringify(transportUrl)};
import { createDurableWebReadWorker } from ${JSON.stringify(workerUrl)};
import { createPlaywrightReadAdapter } from ${JSON.stringify(playwrightAdapterUrl)};
import { assertNoSymlinkOrJunction, createHostAuthorizer, validateEnrollmentList, verifyHostPackageIntegrity } from ${JSON.stringify(packageUrl)};

const dir = await assertNoSymlinkOrJunction(dirname(fileURLToPath(import.meta.url)));
await verifyHostPackageIntegrity({ targetDir: dir });
const config = JSON.parse(await readFile(await assertNoSymlinkOrJunction(join(dir, 'host-config.json')), 'utf8'));
const hostPrivateKey = createPrivateKey(await readFile(await assertNoSymlinkOrJunction(join(dir, 'host-private.pem')), 'utf8'));
const enrollments = validateEnrollmentList(JSON.parse(await readFile(await assertNoSymlinkOrJunction(join(dir, 'enrollments.json')), 'utf8')));
const callerOrigin = process.argv[2] || '';
const active = enrollments.filter(e => e.hostId === config.hostId && e.extensionOrigin === config.extensionOrigin && e.revokedAt === null);
if (callerOrigin !== config.extensionOrigin || active.length !== 1 || config.authorizeRead !== true) {
  process.exitCode = 1;
  throw Error('native-host-enrollment-required');
}
const device = active[0];
const authorizer = await createHostAuthorizer({
  targetDir: dir,
  hostId: config.hostId,
  extensionOrigin: config.extensionOrigin,
  deviceId: device.deviceId,
  devicePublicKey: device.devicePublicKey,
});
const db = new PGlite(config.dbPath);
try {
  await db.exec(await readFile(await assertNoSymlinkOrJunction(config.migrationPath), 'utf8'));
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
  const adapterModule = config.allowUnverifiedTestAdapter === true && config.adapterModulePath ? await import(config.adapterModulePath) : null;
  const adapter = adapterModule?.createAdapter
    ? adapterModule.createAdapter(config)
    : config.adapterMode === 'playwright'
      ? createPlaywrightReadAdapter({ origin: config.origin, actorRef: config.actorRef, allowedPaths: config.paths, requiredMarker: config.requiredMarker ?? null })
      : {
          health: async () => ({ status: 'held', actorRef: config.actorRef, grantedScopes: [] }),
          execute: async () => { throw Error('native-host-browser-adapter-not-configured'); },
          observe: async () => ({ verified: false, origin: config.origin }),
          unbind: async () => ({ revoked: true }),
        };
  const worker = authorizer.wrapWorker(createDurableWebReadWorker({
    db,
    routes: [{ protocol: 'playwright', binding, adapter, allowedPaths: config.paths }],
    clock: () => new Date().toISOString(),
    authorizeRead: authorizer.verifyActive,
  }));
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
    authorize: authorizer.verifyActive,
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
  allowUnverifiedTestAdapter = false,
  productionMode = false,
  adapterMode = 'stub',
  requiredMarker = null,
} = {}) {
  if (!absPathOk(targetDir) || !absPathOk(repoRoot) || !EXT.test(extensionOrigin || '') ||
      !ID.test(hostId || '') || !ID.test(actorRef || '') || !validOrigin(origin) ||
      !Array.isArray(paths) || !paths.length || paths.length > 32 || paths.some(p => !pathOk(p))) {
    throw Error('native-host-package-config-invalid');
  }
  if (adapterModulePath !== null && (productionMode === true || allowUnverifiedTestAdapter !== true)) {
    throw Error('native-host-unverified-adapter-denied');
  }
  const dest = resolve(targetDir);
  await mkdir(dest);
  await assertNoSymlinkOrJunction(dest);
  const dirAcl = await restrictDirectoryAcl({ dirPath: dest });

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
    adapterModulePath: allowUnverifiedTestAdapter === true ? adapterModulePath : null,
    allowUnverifiedTestAdapter: allowUnverifiedTestAdapter === true && productionMode !== true,
    adapterMode: adapterMode === 'playwright' ? 'playwright' : 'stub',
    requiredMarker,
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

  const privateKeyPath = join(dest, 'host-private.pem');
  await atomicWriteFile(join(dest, 'host-config.json'), JSON.stringify(hostConfig, null, 2) + '\n', { mode: 0o600 });
  await atomicWriteFile(privateKeyPath, identity.hostPrivateKeyPem, { mode: 0o600 });
  const privateKeyAcl = await restrictPrivateKeyAcl({ privateKeyPath });
  await atomicWriteFile(join(dest, 'enrollments.json'), '[]\n', { mode: 0o600 });
  await atomicWriteFile(join(dest, 'pairing-info.json'), JSON.stringify(pairingInfo, null, 2) + '\n', { mode: 0o600 });
  await atomicWriteFile(hostScriptPath, renderHostEntrypoint({ repoRoot }), { mode: 0o600 });
  await atomicWriteFile(cmdPath, cmdContent, { mode: 0o700 });
  await atomicWriteFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });

  await writeSignedIntegrityManifest({ dest, repoRoot, hostPrivateKey: createPrivateKey(identity.hostPrivateKeyPem) });

  return Object.freeze({
    targetDir: dest,
    manifestPath,
    cmdPath,
    hostScriptPath,
    privateKeyPath,
    dirAcl,
    privateKeyAcl,
    pairingInfo,
    registryPlan: buildWindowsRegistryManifestPlan({ manifestPath }),
  });
}

export async function enrollNativeDevice({ targetDir, enrollment, clock = () => new Date().toISOString() } = {}) {
  if (!absPathOk(targetDir)) throw Error('native-host-package-dir-invalid');
  const dest = await assertNoSymlinkOrJunction(targetDir);
  return withEnrollmentLock(dest, async () => {
    const config = JSON.parse(await readFile(await assertNoSymlinkOrJunction(join(dest, 'host-config.json')), 'utf8'));
    const parsed = typeof enrollment === 'string' ? JSON.parse(enrollment) : enrollment;
    if (!isPlainDataObject(parsed) || parsed.hostId !== config.hostId || parsed.extensionOrigin !== config.extensionOrigin) {
      throw Error('native-host-enrollment-mismatch');
    }
    const record = buildEnrollmentRecord({
      hostId: parsed.hostId,
      deviceId: parsed.deviceId,
      extensionOrigin: parsed.extensionOrigin,
      devicePublicKey: parsed.devicePublicKey,
      enrolledAt: clock(),
    });
    const enrollmentsPath = await assertNoSymlinkOrJunction(join(dest, 'enrollments.json'));
    const existing = validateEnrollmentList(JSON.parse(await readFile(enrollmentsPath, 'utf8')));
    if (existing.some(e => e.deviceId === record.deviceId || e.devicePublicKey === record.devicePublicKey)) {
      throw Error('native-host-device-already-enrolled');
    }
    if (existing.some(e => e.hostId === record.hostId && e.extensionOrigin === record.extensionOrigin && e.revokedAt === null)) {
      throw Error('native-host-active-device-already-enrolled');
    }
    const next = [...existing, record];
    await atomicWriteFile(enrollmentsPath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    return record;
  });
}

export async function revokeNativeDevice({ targetDir, deviceId, reason = 'owner-revoked', clock = () => new Date().toISOString() } = {}) {
  if (!absPathOk(targetDir)) throw Error('native-host-package-dir-invalid');
  if (!ID.test(deviceId || '')) throw Error('native-host-device-id-invalid');
  const dest = await assertNoSymlinkOrJunction(targetDir);
  return withEnrollmentLock(dest, async () => {
    const enrollmentsPath = await assertNoSymlinkOrJunction(join(dest, 'enrollments.json'));
    const existing = validateEnrollmentList(JSON.parse(await readFile(enrollmentsPath, 'utf8')));
    const index = existing.findIndex(e => e.deviceId === deviceId && e.revokedAt === null);
    if (index === -1) throw Error('native-host-device-not-found-or-revoked');
    const updated = Object.freeze({
      ...existing[index],
      revokedAt: clock(),
      revokedReason: String(reason || 'owner-revoked').slice(0, 120),
    });
    const next = existing.map((e, i) => (i === index ? updated : e));
    await atomicWriteFile(enrollmentsPath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    return updated;
  });
}
