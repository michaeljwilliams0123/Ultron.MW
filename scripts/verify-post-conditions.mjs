/**
 * Task 5: create-once local audit of Task 4's execution receipt.
 * A local Git diff is NEVER proof that a remote GitHub write/release occurred.
 * The PostgreSQL execution ledger and independent remote readback remain authoritative.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const SHA = /^[0-9a-f]{40}$/;
const SUCCESS = new Set(['completed', 'success', 'succeeded', 'executed', 'applied']);
const SCHEMA = 'ultron.task5.local-audit.v1';
const MAX_RECEIPT_BYTES = 65536;
const sha256 = value => createHash('sha256').update(value).digest('hex');

// Take an inert JSON snapshot: no getters, toJSON hooks, functions or cycles.
function snapshotJson(value, seen = new WeakSet(), depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.length <= MAX_RECEIPT_BYTES) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || depth > 8 || seen.has(value))
    throw new Error('execution receipt must contain plain JSON data');
  if (!Array.isArray(value) && ![null, Object.prototype].includes(Object.getPrototypeOf(value)))
    throw new Error('execution receipt must contain plain JSON data');
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (keys.length > 150) throw new Error('execution receipt exceeds object limits');
  let out;
  if (Array.isArray(value)) {
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length > 150 || keys.length !== length + 1)
      throw new Error('execution receipt must contain plain JSON data');
    out = [];
    for (let i = 0; i < length; i++) {
      const d = descriptors[String(i)];
      if (!d || !Object.hasOwn(d, 'value')) throw new Error('execution receipt must contain plain JSON data');
      out.push(snapshotJson(d.value, seen, depth + 1));
    }
  } else {
    out = Object.create(null);
    for (const key of keys) {
      const d = descriptors[key];
      if (!d.enumerable || !Object.hasOwn(d, 'value'))
        throw new Error('execution receipt must contain plain JSON data');
      out[key] = snapshotJson(d.value, seen, depth + 1);
    }
  }
  seen.delete(value);
  return out;
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', maxBuffer: 128 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function validateSha(value, field) {
  if (value !== undefined && value !== null && (typeof value !== 'string' || !SHA.test(value)))
    throw new Error(`invalid ${field}`);
  return value ?? null;
}

function inspectLocalDiff(cwd, baseSha, headSha) {
  if (git(cwd, ['rev-parse', 'HEAD']) !== headSha)
    throw new Error('git HEAD mismatch with execution receipt');
  try { git(cwd, ['merge-base', '--is-ancestor', baseSha, headSha]); }
  catch { throw new Error('execution base is not an ancestor of head'); }
  const changedFiles = git(cwd, ['diff', '--name-only', baseSha, headSha, '--']).split('\n').filter(Boolean);
  if (changedFiles.length === 0) throw new Error('execution diff has no changed files');
  const gitDiffSummary = git(cwd, ['diff', '--stat', baseSha, headSha, '--']);
  return { changedFiles, gitDiffSummary };
}

function verifyRecordOnDisk(destination, receiptDigest, key) {
  if (!existsSync(destination)) return null;
  let record;
  try { record = JSON.parse(readFileSync(destination, 'utf8')); }
  catch { throw new Error('audit integrity mismatch: unreadable local artifact'); }
  if (!record || record.schema !== SCHEMA || record.idempotencyKey !== key ||
      typeof record.auditSha256 !== 'string') throw new Error('audit integrity mismatch');
  const { auditSha256, ...unsigned } = record;
  if (sha256(JSON.stringify(unsigned)) !== auditSha256)
    throw new Error('audit integrity mismatch');
  if (record.executionReceiptDigest !== receiptDigest)
    throw new Error('conflicting audit receipt for existing idempotencyKey');
  return record;
}

function createOnce(destination, artifact) {
  const directory = resolve(destination, '..');
  const tempPath = join(directory, `.task5-${randomBytes(16).toString('hex')}.tmp`);
  const fd = openSync(tempPath, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    fsyncSync(fd);
  } finally { closeSync(fd); }
  try {
    // Atomic hard link: EEXIST means a concurrent worker won; never replace it.
    linkSync(tempPath, destination);
    const dirFd = openSync(directory, 'r');
    try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally { unlinkSync(tempPath); }
}

export async function verifyPostConditionsAndStoreReceipt(executionReceipt, {
  cwd = process.cwd(), receiptDir = resolve(cwd, 'receipts'), now = () => new Date(),
} = {}) {
  const receipt = snapshotJson(executionReceipt);
  if (!receipt || Array.isArray(receipt) || typeof receipt !== 'object')
    throw new Error('invalid execution receipt');
  const { idempotencyKey, status } = receipt;
  if (typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey) || idempotencyKey.includes('..'))
    throw new Error('invalid idempotencyKey');
  if (typeof status !== 'string' || status.length > 80 || status.length === 0)
    throw new Error('invalid execution status');
  const rawJson = JSON.stringify(receipt);
  if (Buffer.byteLength(rawJson) > MAX_RECEIPT_BYTES)
    throw new Error('execution receipt exceeds maximum size');
  const receiptDigest = sha256(rawJson);
  const destination = join(resolve(receiptDir), `${idempotencyKey}.json`);
  const existing = verifyRecordOnDisk(destination, receiptDigest, idempotencyKey);
  if (existing) return existing;

  const details = receipt.details && typeof receipt.details === 'object' && !Array.isArray(receipt.details)
    ? receipt.details : Object.create(null);
  const baseSha = validateSha(details.baseSha ?? receipt.baseSha, 'baseSha');
  const headSha = validateSha(details.headSha ?? details.commitSha ?? receipt.headSha, 'headSha');
  let statusResult = 'EXECUTION_NOT_SUCCEEDED';
  let gitDiffSummary = null;
  let changedFiles = [];
  if (SUCCESS.has(status.toLowerCase())) {
    statusResult = 'REMOTE_READBACK_REQUIRED';
    if (baseSha && headSha) {
      ({ gitDiffSummary, changedFiles } = inspectLocalDiff(cwd, baseSha, headSha));
      statusResult = 'LOCAL_DIFF_VERIFIED_REMOTE_UNVERIFIED';
    }
  }
  const verifiedAt = now().toISOString();
  const artifact = {
    schema: SCHEMA, idempotencyKey, executionReceiptDigest: receiptDigest,
    executionStatus: status, verifiedAt, baseSha, headSha,
    gitDiffSummary, changedFiles, remoteReadbackVerified: false,
    status: statusResult,
  };
  artifact.auditSha256 = sha256(JSON.stringify(artifact));
  mkdirSync(resolve(receiptDir), { recursive: true, mode: 0o700 });
  createOnce(destination, artifact);
  return verifyRecordOnDisk(destination, receiptDigest, idempotencyKey);
}
