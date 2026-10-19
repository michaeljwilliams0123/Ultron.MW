import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LearningLoop } from './learning.mjs';
import { COMMANDS, executeReadOnly } from './operations.mjs';
import { createLocalOllama } from './providers/ollama.mjs';
import { createBrain } from './brain.mjs';
import { createActionGateway, validateAction, keyIsValid, makeSessionKey } from './action-gateway.mjs';
import { ACCEPTED_SEED, CANDIDATE, planObjective, evaluateRouting } from '../docs/core/cycle.mjs';
import { selectExecution } from '../docs/core/providers.mjs';

const sourcePath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(sourcePath), '..');

function response(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    throw Object.assign(new Error('Expected application/json'), { statusCode: 415 });
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8192) throw Object.assign(new Error('Request exceeds 8192 bytes'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); }
}

export async function startLocalServer({ root = defaultRoot, statePath = resolve(root, '.local', 'state.json'), port = Number(process.env.ULTRON_PORT ?? 4782), provider = createLocalOllama(), gateway = createActionGateway({ root }), ownerKey = makeSessionKey() } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local port');
  let state = { objectives: [], receipts: [], plans: [], conversations: [], ownerJobs: [],
    evolution: { accepted: ACCEPTED_SEED, evaluations: [] },
    learning: new LearningLoop().snapshot() };
  try {
    const loaded = JSON.parse(await readFile(statePath, 'utf8'));
    if (!Array.isArray(loaded.objectives) || !loaded.learning ||
      (loaded.receipts !== undefined && !Array.isArray(loaded.receipts))) {
      throw new Error('Stored state has invalid structure');
    }
    // Migrate the original draft-only file without discarding existing objectives.
    state = {
      objectives: loaded.objectives, receipts: loaded.receipts || [],
      plans: Array.isArray(loaded.plans) ? loaded.plans : [],
      conversations: Array.isArray(loaded.conversations) ? loaded.conversations : [],
      ownerJobs: Array.isArray(loaded.ownerJobs) ? loaded.ownerJobs : [],
      evolution: loaded.evolution?.accepted === CANDIDATE ? loaded.evolution :
        { accepted: ACCEPTED_SEED, evaluations: [] },
      learning: new LearningLoop(loaded.learning).snapshot(),
    };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const brain = createBrain({ provider, root, snapshot: () => ({ learning: new LearningLoop(state.learning).snapshot() }) });
  let pending = Promise.resolve();
  async function transact(update) {
    const task = pending.then(async () => {
      const next = structuredClone(state);
      const result = await update(next);
      await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
      const temp = statePath + '.' + randomUUID() + '.pending';
      try {
        await writeFile(temp, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 });
        await rename(temp, statePath);
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw error;
      }
      state = next;
      return result;
    });
    pending = task.then(() => undefined, () => undefined);
    return task;
  }

  const server = createServer(async (req, res) => {
    const actualPort = server.address()?.port;
    const allowedOrigins = new Set(['http://127.0.0.1:' + actualPort, 'http://localhost:' + actualPort]);
    if (!allowedOrigins.has('http://' + req.headers.host) || req.headers['sec-fetch-site'] === 'cross-site') {
      return response(res, 403, { error: 'Untrusted host or request site' });
    }
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        return response(res, 200, await readFile(resolve(root, 'docs', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/app.js') {
        return response(res, 200, await readFile(resolve(root, 'docs', 'app.js'), 'utf8'), 'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && ['/core/cycle.mjs', '/core/providers.mjs'].includes(req.url)) {
        return response(res, 200,
          await readFile(resolve(root, 'docs', req.url.slice(1)), 'utf8'),
          'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/api/health') {
        const model = await brain.status();
        return response(res, 200, { name: 'Ultron', connected: true, mode: 'local-read-only', executionReady: true, autonomousReady: false, modelReady: model.ready, model: model.ready ? model.model : null });
      }
      if (req.method === 'GET' && req.url === '/api/capabilities') {
        const model = await brain.status();
        return response(res, 200, {
          runtime: 'local', autonomy: false, commands: COMMANDS,
          providers: model.ready ? [{ id: 'ollama', model: model.model, ready: true }] : [],
          choices: {
            reasoning: selectExecution({ host: 'local', localModelReady: model.ready }),
            tools: selectExecution({ host: 'local', task: 'read-only', deterministicToolReady: true }),
          },
        });
      }
      if (req.method === 'GET' && req.url === '/api/state') {
        const learning = new LearningLoop(state.learning);
        return response(res, 200, {
          objectives: state.objectives.slice(-100), receipts: state.receipts.slice(-100),
          plans: state.plans.slice(-30), evolution: state.evolution,
          conversations: state.conversations.slice(-24),
          acceptedVersion: learning.accepted, observations: learning.observations.size,
          candidates: learning.candidates.size, executionReady: true, autonomousReady: false,
        });
      }
      // Narrow owner-approved actions on localhost. No model output can call this endpoint.
      if (req.url?.startsWith('/api/owner/')) {
        if (!keyIsValid(req.headers['x-ultron-owner'], ownerKey) ||
            (req.method !== 'GET' && !allowedOrigins.has(req.headers.origin))) {
          return response(res, 403, { error: 'Current owner-session pairing required' });
        }
        if (req.method === 'GET' && req.url === '/api/owner/status') {
          let github = { connected: false };
          try {
            github = { ...(await gateway.identity()), connected: true };
          } catch { /* local notes remain available without GitHub authentication */ }
          return response(res, 200, {
            paired: true, computerReady: true, github,
            actions: ['local-note', 'github-draft'],
            restricted: 'No arbitrary filesystem paths, shell, merge, deploy, or secret management',
          });
        }
        if (req.method === 'GET' && req.url === '/api/owner/jobs') {
          return response(res, 200, {
            jobs: state.ownerJobs.slice(-30).map(job => {
              const { text: _excluded, ...publicJob } = job;
              return publicJob;
            }),
          });
        }
        if (req.method === 'POST') {
          const input = await readJson(req);
          if (req.url === '/api/owner/prepare') {
            const proposal = validateAction(input);
            const job = await transact(next => {
              const old = next.ownerJobs.find(item => item.id === proposal.id);
              if (old) {
                if (old.kind !== proposal.kind || old.title !== proposal.title ||
                    old.text !== proposal.text) {
                  throw Object.assign(new Error('Operation ID already used for different input'), { statusCode: 409 });
                }
                return old;
              }
              const item = { ...proposal, status: 'prepared',
                createdAt: new Date().toISOString() };
              next.ownerJobs.push(item);
              next.ownerJobs = next.ownerJobs.slice(-30);
              return item;
            });
            return response(res, 201, {
              job: { id: job.id, title: job.title, kind: job.kind, status: job.status },
              executed: false,
            });
          }
          if (req.url === '/api/owner/execute') {
            if (typeof input?.id !== 'string') {
              return response(res, 400, { error: 'Prepared operation ID required' });
            }
            const job = await transact(next => {
              const item = next.ownerJobs.find(j => j.id === input.id);
              if (!item || item.status !== 'prepared') return null;
              item.status = 'running';
              item.startedAt = new Date().toISOString();
              return structuredClone(item);
            });
            if (!job) return response(res, 409, {
              error: 'Operation already running, completed, or unavailable. No duplicate execution.',
            });
            const startedAt = Date.now();
            try {
              const outcome = job.kind === 'github-draft'
                ? await gateway.githubDraft(job) : await gateway.localNote(job);
              const receipt = await transact(next => {
                const item = next.ownerJobs.find(j => j.id === job.id);
                item.status = 'verified';
                item.result = outcome;
                item.latencyMs = Date.now() - startedAt;
                item.verifiedAt = new Date().toISOString();
                const rec = {
                  id: 'receipt-' + randomUUID(), kind: 'verified-owner-action',
                  command: job.kind, status: 'succeeded', operationId: job.id,
                  summary: outcome.evidence, details: outcome,
                  createdAt: item.verifiedAt,
                };
                next.receipts.push(rec);
                next.receipts = next.receipts.slice(-100);
                item.receiptId = rec.id;
                return rec;
              });
              return response(res, 201, { receipt, verified: true,
                executed: true, autonomous: false });
            } catch (error) {
              await transact(next => {
                const item = next.ownerJobs.find(j => j.id === job.id);
                item.status = 'reconcile-required';
                item.failureAt = new Date().toISOString();
              });
              return response(res, error.statusCode || 502, {
                verified: false, executed: false, operationId: job.id,
                error: 'Action not fully verified. Inspect its state before any retry.',
              });
            }
          }
          if (req.url === '/api/owner/feedback') {
            if (typeof input?.id !== 'string' ||
                !['helpful','not-helpful'].includes(input?.rating)) {
              return response(res, 400, { error: 'Verified action ID and rating required' });
            }
            const rating = await transact(next => {
              const job = next.ownerJobs.find(j => j.id === input.id && j.status === 'verified');
              if (!job) return null;
              job.rating = input.rating;
              job.ratedAt = new Date().toISOString();
              return { id: job.id, rating: job.rating, receiptId: job.receiptId };
            });
            if (!rating) return response(res, 404, { error: 'Verified operation not found' });
            return response(res, 200, rating);
          }
        }
        return response(res, 404, { error: 'Unsupported owner action' });
      }

      if (req.method === 'POST' && [
        '/api/plan', '/api/plan/run', '/api/learning/evaluate',
        '/api/learning/rollback',
      ].includes(req.url)) {
        if (!allowedOrigins.has(req.headers.origin) || req.headers['x-ultron-client'] !== 'local-ui-v1') {
          return response(res, 403, { error: 'Same-origin local UI request required' });
        }
        const input = await readJson(req);
        if (req.url === '/api/plan') {
          const selected = state.evolution?.accepted || ACCEPTED_SEED;
          const plan = planObjective(input?.text, { strategy: selected });
          const saved = await transact(next => {
            const item = { id: 'plan-' + randomUUID(), ...plan,
              createdAt: new Date().toISOString() };
            next.plans.push(item);
            next.plans = next.plans.slice(-30);
            return item;
          });
          return response(res, 201, { plan: saved, executed: false });
        }
        if (req.url === '/api/plan/run') {
          if (typeof input?.id !== 'string' || !/^plan-[0-9a-f-]{36}$/.test(input.id)) {
            return response(res, 400, { error: 'Valid plan ID required' });
          }
          const result = await transact(async next => {
            const plan = next.plans.find(x => x.id === input.id);
            if (!plan) return null;
            const receipts = [];
            for (const step of plan.steps) {
              if (step.status !== 'ready' || !step.command) continue;
              try {
                const outcome = await executeReadOnly(step.command, { root,
                  learning: new LearningLoop(next.learning).snapshot() });
                const receipt = { id: 'receipt-' + randomUUID(), planId: plan.id,
                  kind: 'deterministic-read', command: outcome.command,
                  status: 'succeeded', summary: outcome.summary,
                  details: outcome.details, createdAt: new Date().toISOString() };
                receipts.push(receipt);
                next.receipts.push(receipt);
                step.status = 'succeeded';
                step.receiptId = receipt.id;
              } catch {
                step.status = 'failed';
                step.reason = 'Read-only operation failed; no successful execution receipt was produced.';
              }
            }
            plan.status = plan.steps.every(step => step.status === 'succeeded') ? 'completed'
              : plan.steps.some(step => step.status === 'succeeded') ? 'partial' : 'blocked';
            plan.updatedAt = new Date().toISOString();
            next.receipts = next.receipts.slice(-100);
            return { plan, receipts };
          });
          if (!result) return response(res, 404, { error: 'Plan not found' });
          return response(res, 200, { ...result, executed: result.receipts.length > 0, autonomous: false });
        }
        if (req.url === '/api/learning/evaluate') {
          const result = await transact(next => {
            const accepted = next.evolution.accepted;
            if (accepted === CANDIDATE) return { status: 'already-adopted', accepted };
            const report = evaluateRouting({ accepted });
            next.evolution.evaluations.push({
              benchmarkId: report.benchmarkId, baselineVersion: report.baselineVersion,
              candidateVersion: report.candidateVersion, baselineAccuracy: report.baselineAccuracy,
              candidateAccuracy: report.candidateAccuracy, delta: report.delta, passed: report.passed,
              criticalRegressions: report.criticalRegressions, regressions: report.regressions,
              total: report.total, evaluatedAt: report.evaluatedAt,
            });
            next.evolution.evaluations = next.evolution.evaluations.slice(-12);
            if (report.passed) next.evolution.accepted = report.candidateVersion;
            return { ...report, status: report.passed ? 'adopted' : 'rejected' };
          });
          return response(res, 200, { evaluation: result });
        }
        if (input?.reason !== 'owner-request') return response(res, 400, { error: 'Explicit rollback reason required' });
        const result = await transact(next => {
          if (next.evolution.accepted === ACCEPTED_SEED) return { status: 'no-change' };
          next.evolution.accepted = ACCEPTED_SEED;
          return { status: 'rolled-back', accepted: ACCEPTED_SEED };
        });
        return response(res, 200, result);
      }
      if (req.method === 'POST' && (req.url === '/api/objectives' || req.url === '/api/execute' || req.url === '/api/think')) {
        if (!allowedOrigins.has(req.headers.origin) || req.headers['x-ultron-client'] !== 'local-ui-v1') {
          return response(res, 403, { error: 'Same-origin local UI request required' });
        }
        const input = await readJson(req);
        if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 1200) {
          return response(res, 400, { error: 'Objective must be 1–1200 characters' });
        }
        const text = input.text.trim();
        if (req.url === '/api/think') {
          const modelStatus = await brain.status();
          if (!modelStatus.ready) {
            return response(res, 503, { error: 'Local model unavailable: ' + modelStatus.reason });
          }
          const context = state.conversations.slice(-3).flatMap(entry => [
            { role: 'user', content: entry.prompt },
            { role: 'assistant', content: entry.answer },
          ]);
          const outcome = await brain.think(text, { context });
          const saved = await transact(next => {
            let toolReceipt = null;
            if (outcome.toolResult) {
              toolReceipt = {
                id: 'receipt-' + randomUUID(), kind: 'deterministic-read',
                command: outcome.toolResult.command,
                status: 'succeeded', summary: outcome.toolResult.summary,
                details: outcome.toolResult.details, createdAt: new Date().toISOString(),
              };
              next.receipts.push(toolReceipt);
            }
            const receipt = {
              id: 'receipt-' + randomUUID(), kind: 'model-response',
              status: 'succeeded', command: 'local-cognition',
              summary: outcome.text, details: { model: outcome.model, usedTool: !!toolReceipt },
              createdAt: new Date().toISOString(),
            };
            next.receipts.push(receipt);
            next.receipts = next.receipts.slice(-100);
            next.conversations.push({
              id: receipt.id, prompt: text, answer: outcome.text,
              model: outcome.model, createdAt: receipt.createdAt,
            });
            next.conversations = next.conversations.slice(-24);
            return { receipt, toolReceipt };
          });
          return response(res, 201, { ...saved, executed: !!saved.toolReceipt, autonomous: false });
        }
        if (req.url === '/api/execute') {
          let outcome;
          try { outcome = await executeReadOnly(text, { root, learning: new LearningLoop(state.learning).snapshot() }); }
          catch (error) { return response(res, error.statusCode || 422, { error: error.message }); }
          const receipt = await transact(next => {
            const item = {
              id: 'receipt-' + randomUUID(), kind: 'deterministic-read', command: outcome.command,
              status: 'succeeded', summary: outcome.summary, details: outcome.details,
              createdAt: new Date().toISOString(),
            };
            next.receipts.push(item);
            next.receipts = next.receipts.slice(-100);
            return item;
          });
          return response(res, 201, { receipt, executed: true, autonomous: false });
        }
        const objective = await transact(next => {
          const item = { id: 'draft-' + randomUUID(), text, status: 'draft', createdAt: new Date().toISOString() };
          next.objectives.push(item);
          next.objectives = next.objectives.slice(-100);
          return item;
        });
        return response(res, 201, { objective, executed: false });
      }
      return response(res, 404, { error: 'Not found' });
    } catch (error) {
      const status = error.statusCode || 500;
      if (status === 500) console.error('Ultron request failed:', error.message);
      return response(res, status, { error: status === 500 ? 'Local runtime failed' : error.message });
    }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  return { server, port: server.address().port, ownerKey,
    close: () => new Promise((ok, fail) => server.close(error => error ? fail(error) : ok())) };
}

if (process.argv[1] && resolve(process.argv[1]) === sourcePath) {
  startLocalServer().then(app => { console.log('Ultron local UI: http://127.0.0.1:' + app.port); console.log('Local owner pairing key (changes on restart): ' + app.ownerKey); })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
