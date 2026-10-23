import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, realpath, readFile, rm, access } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAX_BROWSER_FILE_BYTES = 8 * 1024 * 1024;
const safeName = name => typeof name === 'string' &&
  /^[a-z0-9][a-z0-9_.-]{0,79}$/i.test(name) &&
  !name.includes('..') && name !== '.' && name !== '..';

async function approvedRoot(root) {
  if (typeof root !== 'string' || !isAbsolute(root))
    throw Error('An explicit absolute owner-approved directory is required');
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error('Owner-approved root is not a regular directory');
  return realpath(root);
}

export async function validateUploadFile(path, uploadRoot) {
  const root = await approvedRoot(uploadRoot);
  if (typeof path !== 'string' || !isAbsolute(path))
    throw Error('Upload requires an absolute local file path');
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw Error('Upload file must be a regular file, never a symlink');
  const canonical = await realpath(path);
  const rel = relative(root, canonical);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
    throw Error('Upload file outside the approved directory root');
  if (stat.size < 1 || stat.size > MAX_BROWSER_FILE_BYTES)
    throw Error('Upload file size outside bounded limit');
  const sha256 = createHash('sha256').update(await readFile(canonical)).digest('hex');
  return { path: canonical, name: basename(canonical), bytes: stat.size, sha256 };
}

export async function verifyDownloadDestination(outputRoot, outputName) {
  if (!safeName(outputName)) throw Error('Unsafe download filename');
  const root = await approvedRoot(outputRoot);
  const dest = join(root, outputName);
  try {
    await access(dest);
    throw Error('Download would overwrite an existing local file');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return dest;
}

export async function receiveDownload(download, outputRoot, outputName) {
  const dest = await verifyDownloadDestination(outputRoot, outputName);
  if (!download || typeof download.createReadStream !== 'function')
    throw Error('No real Playwright download stream was provided');
  const stream = await download.createReadStream();
  if (!stream || !(stream instanceof Readable))
    throw Error('Download stream unavailable');
  let bytes = 0, created = false;
  const hash = createHash('sha256');
  const bound = new Transform({
    transform(chunk, _, callback) {
      bytes += chunk.length;
      if (bytes > MAX_BROWSER_FILE_BYTES) {
        callback(Error('Download exceeds bounded file size'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const sink = createWriteStream(dest, { flags: 'wx', mode: 0o600 });
  sink.once('open', () => { created = true; });
  try {
    await pipeline(stream, bound, sink);
    if (bytes < 1) throw Error('Empty download is not accepted');
    const disk = await readFile(dest);
    const digest = hash.digest('hex');
    if (disk.length !== bytes ||
        createHash('sha256').update(disk).digest('hex') !== digest)
      throw Error('Independent download readback mismatch');
    return Object.freeze({ verifiedEffect: true, bytes, sha256: digest });
  } catch (error) {
    // Never erase a pre-existing owner file if exclusive creation failed.
    if (created) await rm(dest, { force: true }).catch(() => {});
    throw error;
  }
}
