import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SID_RE = /^S-1-[0-9-]+$/;

async function restrictScopedDir(dirPath) {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
    const sid = (stdout.trim().split(',')[1] || '').replace(/^"|"$/g, '').trim();
    if (!SID_RE.test(sid)) throw Error('windows-scoped-sid-unavailable');
    await execFileAsync('icacls.exe', [dirPath, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true });
    return;
  }
  await chmod(dirPath, 0o700);
}
const APPROVED_EXECUTABLES = new Set(['node', 'git', 'npm']);
const SAFE_ARG_RE = /^[a-zA-Z0-9_./:=+-]{1,200}$/;
const sha256 = v => createHash('sha256').update(v).digest('hex');

const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

async function assertSafeExistingPath(targetPath) {
  const resolved = resolve(targetPath);
  const st = await lstat(resolved);
  if (st.isSymbolicLink()) throw Error('windows-scoped-symlink-denied');
  const real = await realpath(resolved);
  const parentReal = await realpath(dirname(resolved));
  if (!samePath(real, join(parentReal, basename(resolved)))) throw Error('windows-scoped-reparse-denied');
  return real;
}

function assertInsideRoot(rootReal, relPath) {
  if (typeof relPath !== 'string' || !relPath || isAbsolute(relPath) || win32.isAbsolute(relPath)) {
    throw Error('windows-scoped-path-denied');
  }
  const candidate = resolve(rootReal, relPath);
  const rel = relative(rootReal, candidate);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw Error('windows-scoped-path-escape-denied');
  }
  return candidate;
}

export async function createWindowsScopedExecutor({ rootDir, authorize = async () => true } = {}) {
  if (typeof rootDir !== 'string' || !isAbsolute(rootDir) || typeof authorize !== 'function') {
    throw Error('windows-scoped-config-invalid');
  }
  await mkdir(resolve(rootDir), { recursive: true });
  const rootReal = await assertSafeExistingPath(rootDir);
  await restrictScopedDir(rootReal);

  async function requireAuth(op, target) {
    if ((await authorize({ operation: op, target })) !== true) {
      throw Error('windows-scoped-authorization-denied');
    }
  }

  return Object.freeze({
    rootDir: rootReal,
    async createScopedDir(relDir) {
      await requireAuth('fs.createScopedDir', relDir);
      const target = assertInsideRoot(rootReal, relDir);
      await mkdir(target, { recursive: true });
      const real = await assertSafeExistingPath(target);
      return Object.freeze({ created: true, path: real });
    },
    async writeScopedFile(relPath, content) {
      await requireAuth('fs.writeScopedFile', relPath);
      if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 512_000) {
        throw Error('windows-scoped-content-invalid');
      }
      const target = assertInsideRoot(rootReal, relPath);
      await mkdir(dirname(target), { recursive: true });
      const parentReal = await assertSafeExistingPath(dirname(target));
      const finalTarget = join(parentReal, basename(target));
      const tmp = `${finalTarget}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
      const fh = await open(tmp, 'wx', 0o600);
      try {
        await fh.writeFile(content, 'utf8');
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(tmp, finalTarget);
      return Object.freeze({ written: true, path: finalTarget, sha256: sha256(content) });
    },
    async readScopedFile(relPath) {
      await requireAuth('fs.readScopedFile', relPath);
      const target = assertInsideRoot(rootReal, relPath);
      const real = await assertSafeExistingPath(target);
      const content = await readFile(real, 'utf8');
      return Object.freeze({ path: real, content, sha256: sha256(content) });
    },
    async runApproved(executable, args = [], { timeoutMs = 15_000 } = {}) {
      await requireAuth('proc.runApproved', executable);
      if (!APPROVED_EXECUTABLES.has(executable) || !Array.isArray(args) || args.length > 20 ||
          args.some(a => typeof a !== 'string' || !SAFE_ARG_RE.test(a)) ||
          !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
        throw Error('windows-scoped-command-denied');
      }
      const cmd = executable === 'node' ? process.execPath : executable;
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: rootReal,
        shell: false,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 256 * 1024,
      });
      return Object.freeze({
        exitCode: 0,
        stdoutDigest: sha256(stdout),
        stderrDigest: sha256(stderr),
        stdoutPreview: stdout.slice(0, 500),
      });
    },
    async cleanupScoped(relPath) {
      await requireAuth('fs.cleanupScoped', relPath);
      const target = assertInsideRoot(rootReal, relPath);
      await rm(target, { recursive: true, force: true });
      return Object.freeze({ cleaned: true, target });
    },
  });
}
