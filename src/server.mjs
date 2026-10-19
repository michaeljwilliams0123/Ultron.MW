import { createServer } from 'node:http';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LearningLoop } from './learning.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const statePath = resolve(root, '.local', 'state.json');
const port = Number(process.env.ULTRON_PORT || 4782);
const host = '127.0.0.1';
let state = { objectives: [], learning: new LearningLoop().snapshot() };
try {
  const loaded = JSON.parse(await readFile(statePath, 'utf8'));
  if (Array.isArray(loaded.objectives)) state.objectives = loaded.objectives;
  state.learning = new LearningLoop(loaded.learning).snapshot();
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
let writing = Promise.resolve();
function save() {
  writing = writing.catch(() => {}).then(async () => {
    await mkdir(dirname(statePath), { recursive: true });
    const temp = statePath + '.pending';
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, statePath);
  });
  return writing;
}
function reply(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function localOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  return !origin || origin === 'http://127.0.0.1:' + port || origin === 'http://localhost:' + port;
}
async function parseJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString('utf8');
    if (body.length > 8192) throw new Error('Request body exceeds limit');
  }
  return JSON.parse(body);
}
const server = createServer(async (req, res) => {
  try {
    if (!localOrigin(req)) return reply(res, 403, { error: 'Cross-origin access denied' });
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      return reply(res, 200, await readFile(resolve(root, 'docs', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && req.url === '/api/health') {
      return reply(res, 200, { name: 'Ultron', connected: true, mode: 'local-draft-only', executionReady: false });
    }
    if (req.method === 'GET' && req.url === '/api/state') {
      return reply(res, 200, { objectives: state.objectives, acceptedVersion: state.learning.accepted, observations: state.learning.observations.length, candidates: state.learning.candidates.length, executionReady: false });
    }
    if (req.method === 'POST' && req.url === '/api/objectives') {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json' || req.headers['x-ultron-client'] !== 'local-ui-v1') {
        return reply(res, 403, { error: 'Local UI request required' });
      }
      const input = await parseJson(req);
      if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1200) return reply(res, 400, { error: 'Objective must be 1–1200 characters' });
      const objective = { id: 'draft-' + crypto.randomUUID(), text: input.text.trim(), status: 'draft', createdAt: new Date().toISOString() };
      state.objectives.push(objective);
      state.objectives = state.objectives.slice(-100);
      await save();
      return reply(res, 201, { objective, executionReady: false });
    }
    return reply(res, 404, { error: 'Not found' });
  } catch (e) {
    return reply(res, 400, { error: e instanceof SyntaxError ? 'Invalid JSON' : 'Request failed' });
  }
});
server.listen(port, host, () => console.log('Ultron local UI: http://' + host + ':' + port));
