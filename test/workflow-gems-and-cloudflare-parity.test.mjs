import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditWorkflowReferences } from '../scripts/check-workflow-references.mjs';
import { scanWorkflow } from '../src/workflow-consolidation.mjs';

const rootUrl = new URL('../', import.meta.url);
const rootDir = fileURLToPath(rootUrl);
const workflowsDir = join(rootDir, '.github', 'workflows');
const workflowFiles = readdirSync(workflowsDir).filter(f => /\.ya?ml$/.test(f)).sort();
const readWorkflow = name => readFileSync(join(workflowsDir, name), 'utf8');

test('check-cloudflare-parity.mjs passes on repo root and fails closed on drift', () => {
  const ok = spawnSync(process.execPath, [join(rootDir, 'scripts', 'check-cloudflare-parity.mjs')], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Cloudflare parity OK/);

  const tempRoot = mkdtempSync(join(tmpdir(), 'ultron-cf-parity-'));
  try {
    mkdirSync(join(tempRoot, 'scripts'), { recursive: true });
    cpSync(join(rootDir, 'scripts', 'check-cloudflare-parity.mjs'), join(tempRoot, 'scripts', 'check-cloudflare-parity.mjs'));
    cpSync(join(rootDir, 'cloudflare'), join(tempRoot, 'cloudflare'), { recursive: true });

    // 1. Tamper cron in wrangler.toml -> must fail closed
    const wranglerPath = join(tempRoot, 'cloudflare', 'edge-shield', 'wrangler.toml');
    const originalToml = readFileSync(wranglerPath, 'utf8');
    writeFileSync(wranglerPath, originalToml.replace('0 */6 * * *', '0 */12 * * *'));
    const badCron = spawnSync(process.execPath, [join(tempRoot, 'scripts', 'check-cloudflare-parity.mjs')], {
      cwd: tempRoot,
      encoding: 'utf8',
    });
    assert.notEqual(badCron.status, 0);
    assert.match(badCron.stderr, /crons/);

    // 2. Restore wrangler.toml and break worker.mjs syntax -> must fail closed
    writeFileSync(wranglerPath, originalToml);
    const workerPath = join(tempRoot, 'cloudflare', 'agent-relay', 'worker.mjs');
    writeFileSync(workerPath, 'export default { async fetch( { }\n');
    const badSyntax = spawnSync(process.execPath, [join(tempRoot, 'scripts', 'check-cloudflare-parity.mjs')], {
      cwd: tempRoot,
      encoding: 'utf8',
    });
    assert.notEqual(badSyntax.status, 0);
    assert.match(badSyntax.stderr, /syntax check failed/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('check-workflow-references.mjs verifies all 15 workflows with zero errors', () => {
  const result = auditWorkflowReferences(rootUrl);
  assert.deepEqual(result.errors, []);
  assert.equal(result.workflowCount, 15);
  assert.ok(result.referencesChecked >= 100, `expected >= 100 references, got ${result.referencesChecked}`);
});

test('every workflow has top-level permissions, concurrency, per-job timeout-minutes, and staggered crons', () => {
  const crons = [];
  for (const file of workflowFiles) {
    const yml = readWorkflow(file);
    assert.match(yml, /^permissions:\n  contents: read\n/m, `${file} missing read-only default permissions`);
    assert.match(yml, /^\s*concurrency:\s*$/m, `${file} missing concurrency block`);

    const jobs = scanWorkflow(yml).jobs;
    assert.ok(jobs.length > 0, `${file} must declare at least one job`);
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const start = yml.indexOf(`\n  ${job}:\n`);
      const end = i + 1 < jobs.length ? yml.indexOf(`\n  ${jobs[i + 1]}:\n`, start + 1) : yml.length;
      const body = yml.slice(start, end > start ? end : yml.length);
      if (!/^\s+uses:\s+\./m.test(body)) {
        assert.match(body, /^\s+timeout-minutes:\s+\d+/m, `${file}#${job} missing timeout-minutes`);
      }
    }

    for (const m of yml.matchAll(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/gm)) {
      crons.push({ file, cron: m[1] });
    }
  }

  const cronStrings = crons.map(c => c.cron);
  assert.equal(new Set(cronStrings).size, cronStrings.length, `duplicate crons found: ${JSON.stringify(crons)}`);
  assert.ok(crons.some(c => c.file === 'release-authorize.yml' && c.cron === '7 * * * *'));
  assert.ok(crons.some(c => c.file === 'lane-ops-audit.yml' && c.cron === '17 * * * *'));
  assert.ok(crons.some(c => c.file === 'lane-ops-audit.yml' && c.cron === '37 * * * *'));
});

test('universal-loop.yml enforces bounded matrix, retry, script confinement, and owner-gated recursion', () => {
  const yml = readWorkflow('universal-loop.yml');
  const scanned = scanWorkflow(yml);
  assert.deepEqual([...scanned.triggers].sort(), ['workflow_call', 'workflow_dispatch']);
  assert.deepEqual(scanned.jobs, ['prepare-list', 'execute-loop', 'dispatch-contract']);

  // Bounds & confinement checks
  assert.match(yml, /items\.length > 25/);
  assert.match(yml, /Math\.min\(5,\s*Math\.max\(1,/);
  assert.match(yml, /Math\.min\(30,\s*Math\.max\(0,/);
  assert.match(yml, /Math\.min\(10,\s*Math\.max\(1,/);
  assert.match(yml, /\^scripts\\\/\[A-Za-z0-9_.\-\]\+\\\.mjs\$/);
  assert.match(yml, /\^\[A-Za-z0-9_.\-\]\+\\\.ya\?ml\$/);

  // Security & pinning
  assert.match(yml, /github\.event_name == 'workflow_dispatch'/);
  assert.match(yml, /github\.actor == 'michaeljwilliams0123'/);
  assert.match(yml, /github\.actor_id == '308995719'/);
  assert.match(yml, /Total attempt budget exceeded/);
  assert.match(yml, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(yml, /actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1/);
  assert.match(yml, /persist-credentials:\s*false/);
});

test('contract-validation.yml and lane-ops-audit stale reaper preserve security invariants', () => {
  const contract = readWorkflow('contract-validation.yml');
  assert.match(contract, /node scripts\/check-workflow-references\.mjs/);
  assert.match(contract, /node scripts\/check-cloudflare-parity\.mjs/);
  assert.match(contract, /node scripts\/audit-secret-isolation\.mjs/);
  assert.match(contract, /git config --global safe\.bareRepository explicit/);
  assert.match(contract, /persist-credentials:\s*false/);

  const ops = readWorkflow('lane-ops-audit.yml');
  const reaper = ops.split('\n  reap-stale-queued-runs:\n')[1];
  assert.ok(reaper, 'reap-stale-queued-runs job missing');
  assert.match(reaper, /github\.event\.schedule == '37 \* \* \* \*'/);
  assert.match(reaper, /inputs\.ops_task == 'reap-stale-queued-runs' &&\s+github\.actor == 'michaeljwilliams0123'/);
  assert.match(reaper, /actions:\s*read/);
});

test('generic loop restricts effects and queued-run audit preserves evidence', () => {
  const loop = readWorkflow('universal-loop.yml');
  assert.match(loop, /allowedScripts/);
  assert.match(loop, /ownerManualMain/);
  assert.match(loop, /target !== 'contract-validation.yml'/);
  const reaper = readWorkflow('lane-ops-audit.yml').split('\n  reap-stale-queued-runs:\n')[1];
  assert.match(reaper, /actions:\s*read/);
  assert.doesNotMatch(reaper, /deleteWorkflowRun|actions:\s*write/);
});

test('universal loop admission exercises actual inline validator without external effects', () => {
  const yml = readWorkflow('universal-loop.yml');
  const match = yml.match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/);
  assert.ok(match, 'inline validator missing');
  const dir = mkdtempSync(join(tmpdir(), 'ultron-loop-admission-'));
  try {
    const output = join(dir, 'output');
    const base = {
      MODE: 'matrix', ACTION: 'noop-canary', TARGET: '', ITEMS_JSON: '["canary"]',
      INPUT_RUNNER_LABELS: '', VAR_RUNNER_LABELS: '', RETRY_ATTEMPTS: '1',
      RETRY_DELAY: '0', ITERATION: '1', MAX_ITERATIONS: '1',
      GITHUB_REPOSITORY: 'michaeljwilliams0123/Ultron.MW', REPO_PRIVATE: 'false',
      GITHUB_ACTOR_ID: '308995719', GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/main', GITHUB_OUTPUT: output,
    };
    const run = (overrides = {}) => {
      writeFileSync(output, '');
      return spawnSync(process.execPath, ['--input-type=module', '-e', match[1]], {
        encoding: 'utf8', env: {...process.env, ...base, ...overrides},
      });
    };
    assert.equal(run().status, 0);
    assert.equal(run({MODE:'recursive',MAX_ITERATIONS:'3'}).status, 0);
    assert.match(readFileSync(output,'utf8'), /max_iterations=3/);
    assert.equal(run({ACTION:'run-script',TARGET:'scripts/check-cloudflare-parity.mjs'}).status, 0);
    assert.equal(run({ACTION:'dispatch-workflow',TARGET:'contract-validation.yml'}).status, 0);
    for (const bad of [
      {REPO_PRIVATE:'true'}, {GITHUB_REPOSITORY:'foreign/repo'},
      {ACTION:'dispatch-workflow',TARGET:'release-authorize.yml'},
      {ACTION:'dispatch-workflow',TARGET:'contract-validation.yml',RETRY_ATTEMPTS:'2'},
      {ACTION:'dispatch-workflow',TARGET:'contract-validation.yml',MODE:'recursive',MAX_ITERATIONS:'2'},
      {ACTION:'run-script',TARGET:'scripts/verify.mjs'},
      {ACTION:'run-script',TARGET:'scripts/check-cloudflare-parity.mjs',GITHUB_ACTOR_ID:'1'},
      {ACTION:'run-script',TARGET:'scripts/check-cloudflare-parity.mjs',GITHUB_REF:'refs/heads/feature'},
      {ITEMS_JSON:'["same","same"]'}, {ITEMS_JSON:'[{"item":"x"}]'},
      {INPUT_RUNNER_LABELS:'["self-hosted"]'},
      {MODE:'recursive',MAX_ITERATIONS:'10',RETRY_ATTEMPTS:'5',ITEMS_JSON:JSON.stringify(['one','two','three'])},
    ]) {
      const r = run(bad);
      assert.notEqual(r.status, 0, JSON.stringify(bad));
      assert.equal(readFileSync(output,'utf8'), '');
    }
  } finally {
    rmSync(dir, {recursive:true,force:true});
  }
});
