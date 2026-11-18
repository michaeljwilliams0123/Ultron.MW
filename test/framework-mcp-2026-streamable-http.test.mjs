import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamableHttpMcpHandler } from '../src/framework-integration-runtime.mjs';
import { createSigningKey, issueCapabilityToken } from '../src/capability-credentials.mjs';

const ORIGIN = 'https://ultron-mw-cloud.hatchable.site';
const CONFIG = { name: 'cloud-status', kind: 'mcp', operations: ['status', 'ci'] };
const NOW = 1794900000;

const githubGet = async path => {
  if (path.endsWith('/actions/runs?per_page=3')) {
    return { workflow_runs: [{ id: 1, head_sha: 'a'.repeat(40), conclusion: 'success', status: 'completed' }] };
  }
  return { full_name: 'michaeljwilliams0123/Ultron.MW', visibility: 'private', default_branch: 'main' };
};

const req = (body, { method = 'POST', headers = {} } = {}) => new Request('https://ultron-mw-cloud.hatchable.site/mcp', {
  method,
  headers: {
    origin: ORIGIN,
    'content-type': 'application/json',
    'mcp-protocol-version': '2026-07-28',
    ...headers,
  },
  body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
});

test('Streamable HTTP MCP handles 2026-07-28 server/discover and tools/call statelessly', async () => {
  const key = createSigningKey();
  const token = issueCapabilityToken({ key, audience: 'cloud-status', scopes: ['status:read'], now: NOW });
  const handle = createStreamableHttpMcpHandler(CONFIG, { githubGet, key, now: NOW });

  const discover = await handle(req({
    jsonrpc: '2.0',
    id: 1,
    method: 'server/discover',
    params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } },
  }, { headers: { authorization: 'Bearer ' + token } }));
  assert.equal(discover.status, 200);
  assert.equal(discover.headers.get('cache-control'), 'no-store');
  const payload = await discover.json();
  assert.equal(payload.result.resultType, 'complete');
  assert.deepEqual(payload.result.supportedVersions, ['2026-07-28', '2025-06-18']);
});

test('Streamable HTTP MCP returns 202 Accepted for notifications/initialized', async () => {
  const handle = createStreamableHttpMcpHandler(CONFIG, { githubGet });
  const res = await handle(req({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.equal(res.status, 202);
});

test('Streamable HTTP MCP rejects GET SSE, Mcp-Session-Id, bad Origin, bad protocol version, and bad token', async () => {
  const key = createSigningKey();
  const handle = createStreamableHttpMcpHandler(CONFIG, { githubGet, key, now: NOW });

  assert.equal((await handle(req(null, { method: 'GET' }))).status, 405);
  assert.equal((await handle(req({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { 'mcp-session-id': 'sess-1' } }))).status, 400);
  assert.equal((await handle(req({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { origin: 'https://evil.example' } }))).status, 403);
  assert.equal((await handle(req({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { 'mcp-protocol-version': '1999-01-01' } }))).status, 400);
  assert.equal((await handle(req({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))).status, 401);
});

test('Streamable HTTP MCP rejects non-JSON content type and malformed JSON bodies', async () => {
  const handle = createStreamableHttpMcpHandler(CONFIG, { githubGet });
  assert.equal((await handle(req('{}', { headers: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await handle(req('{bad-json'))).status, 400);
  assert.equal((await handle(req([]))).status, 400);
});


test('2026-07-28 modern routing requires headers matching the JSON-RPC method and name', async () => {
  const handle = createStreamableHttpMcpHandler(CONFIG, { githubGet });
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {} };
  const call = { jsonrpc: '2.0', id: 21, method: 'tools/call',
    params: { name: 'ultron_status', arguments: {}, _meta: meta } };
  const send = async (headers = {}) => handle(req(call, { headers }));
  for (const headers of [
    { 'mcp-method': 'tools/list', 'mcp-name': 'ultron_status' },
    { 'mcp-method': 'tools/call', 'mcp-name': 'different_tool' },
    { 'mcp-method': 'tools/call' },
    { 'mcp-name': 'ultron_status' },
  ]) {
    const response = await send(headers);
    assert.equal(response.status, 400, JSON.stringify(headers));
    assert.equal((await response.json()).error.code, -32020);
  }
  const accepted = await send({ 'mcp-method': 'tools/call', 'mcp-name': 'ultron_status' });
  assert.equal(accepted.status, 200);
});

test('2026-07-28 transport does not use session IDs and rejects mismatched per-request versions', async () => {
  const handle = createStreamableHttpMcpHandler(CONFIG, { githubGet });
  const modern = { jsonrpc: '2.0', id: 22, method: 'server/discover',
    params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {} } } };
  const good = await handle(req(modern, {
    headers: { 'mcp-method': 'server/discover', 'mcp-session-id': 'ignored-legacy-state' },
  }));
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('mcp-session-id'), null);
  const mismatch = await handle(req(modern, {
    headers: { 'mcp-method': 'server/discover', 'mcp-protocol-version': '2025-06-18' },
  }));
  assert.equal(mismatch.status, 400);
});
