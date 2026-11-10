import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The repository was transferred; its identity remains anchored to this exact full name.
const REPOSITORY = 'Ultron-MW/Ultron.MW';
const WORKFLOW = 'Ultron core verification';
const WORKFLOW_PATH = `${REPOSITORY}/.github/workflows/verify.yml@`;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function positiveInteger(env, name) {
  const value = Number(required(env, name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function buildGitHubVerificationReceipt({ env = process.env, observedSha }) {
  if (required(env, 'GITHUB_ACTIONS') !== 'true') throw new Error('GitHub Actions is required');
  if (required(env, 'GITHUB_REPOSITORY') !== REPOSITORY) {
    throw new Error('unexpected GitHub repository');
  }

  const event = required(env, 'GITHUB_EVENT_NAME');
  if (event !== 'push' && event !== 'pull_request') {
    throw new Error('unexpected GitHub event');
  }
  if (required(env, 'GITHUB_WORKFLOW') !== WORKFLOW) {
    throw new Error('unexpected GitHub workflow');
  }
  const workflowRef = required(env, 'GITHUB_WORKFLOW_REF');
  const scopedRef = workflowRef.startsWith(WORKFLOW_PATH)
    ? workflowRef.slice(WORKFLOW_PATH.length) : '';
  // A prefix check alone accepts arbitrary ref strings and incorrect branch
  // provenance; pin the ref format to the triggering GitHub event.
  if (!(event === 'push' && scopedRef === 'refs/heads/main') &&
      !(event === 'pull_request' && /^refs\/pull\/[1-9][0-9]*\/merge$/.test(scopedRef))) {
    throw new Error('unexpected GitHub workflow ref');
  }
  if (required(env, 'GITHUB_JOB') !== 'attested-receipt') {
    throw new Error('unexpected GitHub job');
  }

  const sourceSha = required(env, 'SOURCE_SHA');
  if (!SHA_PATTERN.test(sourceSha)) throw new Error('SOURCE_SHA must be a full lowercase SHA');
  if (!SHA_PATTERN.test(observedSha ?? '')) throw new Error('observed checkout SHA must be a full lowercase SHA');
  if (sourceSha !== observedSha) throw new Error('checkout SHA does not match SOURCE_SHA');

  const workflowRunId = positiveInteger(env, 'GITHUB_RUN_ID');
  return Object.freeze({
    schemaVersion: 1,
    kind: 'github-attested-verification-receipt',
    result: 'passed',
    repository: REPOSITORY,
    sourceSha,
    observedCheckoutSha: observedSha,
    event,
    workflow: WORKFLOW,
    workflowRef,
    workflowRunId,
    workflowRunAttempt: positiveInteger(env, 'GITHUB_RUN_ATTEMPT'),
    workflowRunUrl: `https://github.com/${REPOSITORY}/actions/runs/${workflowRunId}`,
    job: 'attested-receipt',
    verification: 'node scripts/verify.mjs',
    paidSpendAuthorizedUsd: 0,
  });
}

async function main() {
  const outputPath = resolve(process.argv[2] ?? 'artifacts/github-verification-receipt.json');
  const observedSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const receipt = buildGitHubVerificationReceipt({ observedSha });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
