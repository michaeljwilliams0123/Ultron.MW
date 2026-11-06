import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { decodeExecutionInput } from '../src/autonomy/executor-input.mjs';

test('candidate is bounded and bound to its exact digest', () => {
  const bytes = Buffer.from('console.log(1)');
  const encoded = bytes.toString('base64');
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual(decodeExecutionInput(encoded, digest), bytes);
  assert.throws(() => decodeExecutionInput(encoded, 'a'.repeat(64)), /execution-digest-mismatch/);
  assert.throws(() => decodeExecutionInput('../foo', digest), /invalid-execution-input/);
  assert.throws(() => decodeExecutionInput('A'.repeat(60004), digest), /invalid-execution-input/);
});

test('executor workflow has no signer secrets or write permissions', async () => {
  const workflow = await readFile(new URL('../.github/workflows/isolated-tool-executor.yml', import.meta.url), 'utf8');
  const script = await readFile(new URL('../scripts/actions-isolated-executor.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /secrets\.|id-token:\s*write|contents:\s*write/);
  assert.match(workflow, /persist-credentials: false/);
  for (const flag of ["'--network', 'none'", "'--read-only'", "'--cap-drop', 'ALL'",
    "'--user', '65534:65534'", "'--pids-limit', '64'", "'--memory', '256m'"])
    assert.ok(script.includes(flag), flag);
  assert.match(script, /sha256:557e52a0fcb928ee113df7e1fb5d4f60c1341dbda53f55e3d815ca10807efdce/);
});
