import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LearningLoop } from './learning.mjs';
import { COMMANDS, executeReadOnly } from './operations.mjs';

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

export async function startLocalServer({ root = defaultRoot, statePath = resolve(root, '.local', 'state.json'), port = Number(process.env.ULTRON_PORT ?? 4782) } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local port');
  let state = { objectives: [], receipts: [], learning: new LearningLoop().snapshot() };
  try {
    const loaded = JSON.parse(await readFile(statePath, 'utf8'));
    if (!Array.isArray(loaded.objectives) || !loaded.learning ||
      (loaded.receipts !== undefined && !Array.isArray(loaded.receipts))) {
      throw new Error('Stored state has invalid structure');
    }
    // Migrate the original draft-only file without discarding existing objectives.
    state = { objectives: loaded.objectives, receipts: loaded.receipts || [],
      learning: new LearningLoop(loaded.learning).snapshot() };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
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
      if (req.method === 'GET' && req.url === '/api/health') {
        return response(res, 200, { name: 'Ultron', connected: true, mode: 'local-read-only', executionReady: true, autonomousReady: false });
      }
      if (req.method === 'GET' && req.url === '/api/capabilities') {
        return response(res, 200, { runtime: 'local', autonomy: false, commands: COMMANDS, providers: [] });
      }
      if (req.method === 'GET' && req.url === '/api/state') {
        const learning = new LearningLoop(state.learning);
        return response(res, 200, {
          objectives: state.objectives.slice(-100), receipts: state.receipts.slice(-100),
          acceptedVersion: learning.accepted, observations: learning.observations.size,
          candidates: learning.candidates.size, executionReady: true, autonomousReady: false,
        });
      }
      if (req.method === 'POST' && (req.url === '/api/objectives' || req.url === '/api/execute')) {
        if (!allowedOrigins.has(req.headers.origin) || req.headers['x-ultron-client'] !== 'local-ui-v1') {
          return response(res, 403, { error: 'Same-origin local UI request required' });
        }
        const input = await readJson(req);
        if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 1200) {
          return response(res, 400, { error: 'Objective must be 1–1200 characters' });
        }
        const text = input.text.trim();
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
  return { server, port: server.address().port,
    close: () => new Promise((ok, fail) => server.close(error => error ? fail(error) : ok())) };
}

if (process.argv[1] && resolve(process.argv[1]) === sourcePath) {
  startLocalServer().then(app => console.log('Ultron local UI: http://127.0.0.1:' + app.port))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
