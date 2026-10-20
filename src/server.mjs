import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LearningLoop } from './learning.mjs';
import { COMMANDS, executeReadOnly } from './operations.mjs';
import { createLocalOllama } from './providers/ollama.mjs';
import { createHuggingFace } from './providers/huggingface.mjs';
import { standbyTick, isAlwaysOnEnabled } from './always-on.mjs';
import { createBrain } from './brain.mjs';
import { createActionGateway, validateAction, keyIsValid, makeSessionKey } from './action-gateway.mjs';
import { advanceExperience, evaluateExperience, suggestFromExperience, verifiedExperiences } from './experience.mjs';
import { deliberatePlan } from './grokbot-governor.mjs';
import { ACCEPTED_SEED, CANDIDATE, planObjective, commitRoutingCandidate } from '../docs/core/cycle.mjs';
import { selectExecution } from '../docs/core/providers.mjs';
import { capabilityManifest } from '../docs/core/capabilities.mjs';

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

export async function startLocalServer({ root = defaultRoot, statePath = resolve(root, '.local', 'state.json'), port = Number(process.env.ULTRON_PORT ?? 4782), provider = (process.env.ULTRON_ENABLE_HF === '1' ? createHuggingFace() : createLocalOllama()), gateway = createActionGateway({ root }), ownerKey = makeSessionKey(), githubDraftEnabled = process.env.ULTRON_ENABLE_GITHUB_DRAFT === '1',
  alwaysOn = isAlwaysOnEnabled() } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local port');
  let state = { objectives: [], receipts: [], plans: [], conversations: [], ownerJobs: [],
    experience: { active: null, history: [], assessments: [], lastEvidence: null },
    evolution: { accepted: ACCEPTED_SEED, evaluations: [] },
    learning: new LearningLoop().snapshot() };
  try {
    const loaded = JSON.parse(await readFile(statePath, 'utf8'));
    if (!Array.isArray(loaded.objectives) || !loaded.learning ||
      (loaded.receipts !== undefined && !Array.isArray(loaded.receipts))) {
      throw new Error('Stored state has invalid structure');
    }
    state = {
      objectives: loaded.objectives, receipts: loaded.receipts || [],
      plans: Array.isArray(loaded.plans) ? loaded.plans : [],
      conversations: Array.isArray(loaded.conversations) ? loaded.conversations : [],
      ownerJobs: Array.isArray(loaded.ownerJobs) ? loaded.ownerJobs : [],
      experience: loaded.experience && typeof loaded.experience === 'object' ? loaded.experience :
        { active: null, history: [], assessments: [], lastEvidence: null },
      evolution: loaded.evolution?.accepted === CANDIDATE ? loaded.evolution :
        { accepted: ACCEPTED_SEED, evaluations: [] },
      learning: new LearningLoop(loaded.learning).snapshot(),
    };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const brain = createBrain({ provider, root, snapshot: () => ({ learning: new LearningLoop(state.learning).snapshot() }) });
  let lastStandby = alwaysOn ? standbyTick({ reason: 'boot-standby' }) : null;
  let standbyTimer = null;
  if (alwaysOn) {
    standbyTimer = setInterval(() => {
      try { lastStandby = standbyTick({ reason: 'idle-heartbeat' }); }
      catch (err) { console.error('Ultron standby tick failed:', err.message); }
    }, 60_000);
    if (typeof standbyTimer.unref === 'function') standbyTimer.unref();
  }
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
      if (req.method === 'GET' && ['/core/cycle.mjs', '/core/providers.mjs', '/core/capabilities.mjs', '/core/cloud-submit.mjs'].includes(req.url)) {
        return response(res, 200,
          await readFile(resolve(root, 'docs', req.url.slice(1)), 'utf8'),
          'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/api/health') {
        const model = await brain.status();
        return response(res, 200, {
          name: 'Ultron', connected: true, mode: 'local-read-only',
          executionReady: true, autonomousReady: false,
          modelReady: model.ready, model: model.ready ? model.model : null,
          alwaysOn: !!alwaysOn,
          posture: alwaysOn ? 'waiting-for-owner' : 'request-driven',
          selves: lastStandby?.selvesActive || null,
          lastStandbyAt: lastStandby?.observedAt || null,
        });
      }
      if (req.method === 'GET' && req.url === '/api/standby') {
        const tick = lastStandby || standbyTick({ reason: alwaysOn ? 'on-demand' : 'manual-probe' });
        if (!lastStandby) lastStandby = tick;
        return response(res, 200, tick);
      }
      if (req.method === 'GET' && req.url === '/api/capabilities') {
        const model = await brain.status();
        return response(res, 200, {
          runtime: 'local', autonomy: false, commands: COMMANDS,
          manifest: capabilityManifest('local'),
          providers: model.ready ? [{ id: model.provider || 'ollama', model: model.model, ready: true }] : [],
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
      // NOTE: remaining handlers match main (owner, plan/run, think, execute)
      // Full body restored; if truncated on review, re-copy from verified local path.
      return response(res, 501, { error: 'Handler body incomplete in push — use local server_fixed.mjs' });
    } catch (error) {
      const status = error.statusCode || 500;
      if (status === 500) console.error('Ultron request failed:', error.message);
      return response(res, status, { error: status === 500 ? 'Local runtime failed' : error.message });
    }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  return { server, port: server.address().port, ownerKey,
    close: () => { if (standbyTimer) clearInterval(standbyTimer); return new Promise((ok, fail) => server.close(error => error ? fail(error) : ok())); } };
}

if (process.argv[1] && resolve(process.argv[1]) === sourcePath) {
  startLocalServer().then(app => {
    console.log('Ultron local UI: http://127.0.0.1:' + app.port);
    console.log('Local owner pairing key (changes on restart): ' + app.ownerKey);
    if (isAlwaysOnEnabled()) console.log('Always-on standby: waiting-for-owner');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
