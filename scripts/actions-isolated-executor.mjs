import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { decodeExecutionInput } from '../src/autonomy/executor-input.mjs';

if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    process.env.GITHUB_REPOSITORY !== 'michaeljwilliams0123/Ultron.MW' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.GITHUB_ACTOR !== 'michaeljwilliams0123')
  throw new Error('unapproved-executor-context');
const bytes = decodeExecutionInput(process.env.ULTRON_SOURCE_BASE64, process.env.ULTRON_SOURCE_SHA256);
const dir = await mkdtemp(join(tmpdir(), 'ultron-executor-'));
const name = `ultron-${randomUUID()}`;
const image = 'node:22.15.0-bookworm-slim@sha256:557e52a0fcb928ee113df7e1fb5d4f60c1341dbda53f55e3d815ca10807efdce';
let started = false;
try {
  const source = join(dir, 'candidate.mjs');
  await writeFile(source, bytes, { flag: 'wx', mode: 0o644 });
  const pull = spawnSync('docker', ['pull', image], { timeout: 120000, stdio: 'ignore' });
  if (pull.error || pull.status !== 0) throw new Error('executor-image-unavailable');
  started = true;
  const run = spawnSync('docker', [
    'run', '--name', name, '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '256m',
    '--cpus', '1', '--user', '65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
    '--mount', `type=bind,src=${source},dst=/candidate.mjs,readonly`,
    image, 'node', '/candidate.mjs'
  ], { timeout: 30000, stdio: 'ignore' });
  const receipt = {
    schema: 'ultron.executor-observation.v1',
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    result: run.error?.code === 'ETIMEDOUT' ? 'timed-out' :
      run.error ? 'runner-error' : run.status === 0 ? 'exited-zero' : 'exited-nonzero'
  };
  await writeFile('executor-observation.json', JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
  if (receipt.result === 'runner-error') throw run.error;
} finally {
  const cleanup = started && spawnSync('docker', ['rm', '-f', name], { timeout: 30000, stdio: 'ignore' });
  await rm(dir, { recursive: true, force: true });
  if (cleanup?.error) throw cleanup.error;
  if (cleanup && cleanup.status !== 0) throw new Error('executor-cleanup-unverified');
}
