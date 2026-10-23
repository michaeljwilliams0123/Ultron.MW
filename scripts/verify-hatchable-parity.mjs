#!/usr/bin/env node
// Read-only comparison against a Hatchable get_deployment(version) JSON snapshot.
// This does not fetch credentials, update a cloud project, or prove deployment recency.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE_DIRS = ['api', 'lib', 'mcp', 'migrations'];
const HEX40 = /^[a-f0-9]{40}$/i;
const HEX64 = /^[a-f0-9]{64}$/i;

function allowedFilePath(p) {
  if (typeof p !== 'string' || p.includes('\\') || p.includes('\0') ||
      p.startsWith('/') || p.endsWith('/') ||
      p.split('/').some(s => s === '' || s === '.' || s === '..')) return false;
  return p === 'hatchable.toml' || SOURCE_DIRS.some(d => p.startsWith(d + '/'));
}
function checkedManifest(snapshot, expectedVersion) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 ||
      snapshot.version !== expectedVersion || snapshot.status !== 'live' ||
      !Array.isArray(snapshot.file_manifest) || !snapshot.file_manifest.length) {
    throw Error('Invalid, stale, or non-live deployment manifest');
  }
  const deployed = new Map();
  for (const item of snapshot.file_manifest) {
    if (!item || !allowedFilePath(item.path) || !HEX64.test(item.hash || '') ||
        !Number.isSafeInteger(item.size) || item.size < 0 ||
        deployed.has(item.path)) {
      throw Error('Malformed, duplicate, or unsafe deployment manifest entry');
    }
    deployed.set(item.path, { hash: item.hash.toLowerCase(), size: item.size });
  }
  return deployed;
}
async function localFiles(sourceRoot) {
  const result = new Map();
  async function add(path) {
    if (!allowedFilePath(path)) throw Error('Unsafe local path: ' + path);
    const full = join(sourceRoot, ...path.split('/'));
    const entry = await lstat(full);
    if (!entry.isFile() || entry.isSymbolicLink()) throw Error('Not a regular source file: ' + path);
    const bytes = await readFile(full);
    result.set(path, {
      hash: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length
    });
  }
  async function visit(path) {
    const root = join(sourceRoot, ...path.split('/'));
    const folder = await lstat(root);
    if (!folder.isDirectory() || folder.isSymbolicLink()) throw Error('Not a real directory: ' + path);
    for (const item of await readdir(root, { withFileTypes: true })) {
      const child = path + '/' + item.name;
      if (item.isDirectory()) await visit(child);
      else if (item.isFile()) await add(child);
      else throw Error('Unsupported file type under cloud source: ' + child);
    }
  }
  for (const dir of SOURCE_DIRS) await visit(dir);
  await add('hatchable.toml');
  return result;
}

function committedFiles(repoRoot, sourceRoot, head) {
  const root = resolve(repoRoot);
  const source = resolve(sourceRoot);
  const sourcePrefix = relative(root, source).split(sep).join('/');
  if (!sourcePrefix || sourcePrefix === '..' || sourcePrefix.startsWith('../')) {
    throw Error('Cloud source must be inside the repository');
  }
  const names = execFileSync('git', [
    'ls-tree', '-r', '--name-only', '-z', head, '--', sourcePrefix
  ], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const result = new Map();
  for (const fullPath of names) {
    if (!fullPath.startsWith(sourcePrefix + '/')) {
      throw Error('Git returned a source path outside the requested tree');
    }
    const path = fullPath.slice(sourcePrefix.length + 1);
    if (!allowedFilePath(path)) continue;
    if (result.has(path)) throw Error('Duplicate committed source path: ' + path);
    const bytes = execFileSync('git', ['show', `${head}:${fullPath}`], {
      cwd: root,
      encoding: null,
      maxBuffer: 16 * 1024 * 1024
    });
    result.set(path, {
      hash: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length
    });
  }
  if (!result.size) throw Error('No committed cloud source files found');
  return result;
}

export async function verifyHatchableParity({
  snapshot, sourceRoot, repoRoot, expectedVersion, expectedHead, actualHead
}) {
  if (!HEX40.test(expectedHead || '') || !HEX40.test(actualHead || '')) {
    throw Error('Expected and observed Git commit SHAs must each be 40 hexadecimal characters');
  }
  const deployed = checkedManifest(snapshot, expectedVersion);
  const source = repoRoot
    ? committedFiles(repoRoot, sourceRoot, expectedHead)
    : await localFiles(resolve(sourceRoot));
  const differences = [];
  if (expectedHead.toLowerCase() !== actualHead.toLowerCase()) {
    differences.push({ type: 'stale-head', expected: expectedHead, observed: actualHead });
  }
  for (const [path, actual] of source) {
    const deployedFile = deployed.get(path);
    if (!deployedFile) differences.push({ type: 'missing-deployment-file', path });
    else if (actual.hash !== deployedFile.hash || actual.size !== deployedFile.size) {
      differences.push({ type: 'changed-file', path });
    }
  }
  for (const path of deployed.keys()) {
    if (!source.has(path)) differences.push({ type: 'missing-source-file', path });
  }
  return {
    parity: differences.length === 0,
    expectedHead,
    deploymentVersion: expectedVersion,
    filesCompared: source.size,
    differences: differences.sort((a, b) => (a.type + (a.path || '')).localeCompare(b.type + (b.path || '')))
  };
}
function parseCli(args) {
  if (args.length !== 6) throw Error('Usage: node scripts/verify-hatchable-parity.mjs --manifest FILE --version N --head EXACT40SHA');
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--manifest', '--version', '--head'].includes(args[i]) || opts[args[i]]) {
      throw Error('Invalid or duplicate CLI option');
    }
    opts[args[i]] = args[i + 1];
  }
  if (!opts['--manifest'] || !/^[1-9]\d*$/.test(opts['--version'] || '') ||
      !HEX40.test(opts['--head'] || '')) throw Error('Missing or invalid CLI option');
  return opts;
}
async function cli() {
  const opts = parseCli(process.argv.slice(2));
  const repoRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
  const actualHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot, encoding: 'utf8'
  }).trim();
  const snapshot = JSON.parse(await readFile(resolve(opts['--manifest']), 'utf8'));
  const result = await verifyHatchableParity({
    snapshot,
    sourceRoot: join(repoRoot, 'cloud/hatchable'),
    repoRoot,
    expectedVersion: Number(opts['--version']),
    expectedHead: opts['--head'],
    actualHead
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.parity) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  cli().catch(err => { console.error('Hatchable parity verification failed: ' + err.message); process.exitCode = 2; });
}
