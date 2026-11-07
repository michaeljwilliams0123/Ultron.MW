import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const GITLAB_PROJECT = 'michaelj.williams0123/Ultron.MW';
const GITHUB_SOURCE = 'michaeljwilliams0123/Ultron.MW';
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

function httpsUrl(env, name) {
  const value = required(env, name);
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS`);
  return url.toString();
}

export function buildGitLabAcceptanceReceipt({ env = process.env, observedSha }) {
  if (required(env, 'CI') !== 'true') throw new Error('GitLab CI is required');
  if (required(env, 'CI_PROJECT_PATH') !== GITLAB_PROJECT) {
    throw new Error('unexpected GitLab project');
  }
  if (required(env, 'CI_PIPELINE_SOURCE') !== 'push') {
    throw new Error('only push pipelines are accepted');
  }

  const ref = required(env, 'CI_COMMIT_REF_NAME');
  if (!ref.startsWith('verify/')) throw new Error('only verify/* refs are accepted');

  const sourceSha = required(env, 'CI_COMMIT_SHA');
  if (!SHA_PATTERN.test(sourceSha)) throw new Error('CI_COMMIT_SHA must be a full lowercase SHA');
  if (!SHA_PATTERN.test(observedSha ?? '')) throw new Error('observed checkout SHA must be a full lowercase SHA');
  if (sourceSha !== observedSha) throw new Error('checkout SHA does not match CI_COMMIT_SHA');

  return Object.freeze({
    schemaVersion: 1,
    kind: 'gitlab-exact-sha-acceptance',
    result: 'passed',
    sourceAuthority: `github:${GITHUB_SOURCE}`,
    verificationProvider: `gitlab:${GITLAB_PROJECT}`,
    sourceSha,
    observedCheckoutSha: observedSha,
    ref,
    pipelineSource: 'push',
    pipelineId: positiveInteger(env, 'CI_PIPELINE_ID'),
    pipelineUrl: httpsUrl(env, 'CI_PIPELINE_URL'),
    jobId: positiveInteger(env, 'CI_JOB_ID'),
    jobUrl: httpsUrl(env, 'CI_JOB_URL'),
    runner: required(env, 'CI_RUNNER_DESCRIPTION'),
    paidSpendAuthorizedUsd: 0,
    billingPolicy: 'included-quota-only-no-paid-fallback',
  });
}

export async function readDetachedGitHead(directory = process.cwd()) {
  const head = (await readFile(join(directory, '.git', 'HEAD'), 'utf8')).trim();
  if (!SHA_PATTERN.test(head)) throw new Error('detached Git HEAD is required');
  return head;
}

async function main() {
  const outputPath = resolve(process.argv[2] ?? 'artifacts/gitlab-exact-sha-acceptance.json');
  const observedSha = await readDetachedGitHead();
  const receipt = buildGitLabAcceptanceReceipt({ observedSha });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
