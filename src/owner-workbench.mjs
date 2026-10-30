/**
 * Owner workbench — expanded GitHub / Actions / internet access for Ultron.
 * Gated by owner autonomy. Operations are explicit allowlisted verbs.
 *
 * Hardening:
 * - HTTPS fetch: no open redirects, private/link-local host deny, stream byte cap
 * - Actions dispatch: allowlisted workflow names + refs only
 */
import { createHash } from 'node:crypto';
import { ownerAutonomyEnabled, autonomyHardFloors } from './owner-autonomy.mjs';

export const WORKBENCH_VERBS = Object.freeze([
  'github.issue.list',
  'github.issue.read',
  'github.issue.comment',
  'github.issue.label',
  'github.pr.list',
  'github.pr.read',
  'github.pr.comment',
  'github.actions.list_runs',
  'github.actions.dispatch',
  'github.actions.job_logs_summary',
  'internet.fetch',
  'internet.search_plan',
]);

export const ALLOWED_DISPATCH_WORKFLOWS = Object.freeze([
  'verify.yml',
  'council-debate.yml',
  'pr-brain.yml',
  'cloud-pr.yml',
  'self-scan-pr.yml',
]);

export const ALLOWED_DISPATCH_REFS = Object.freeze(['main']);

const MAX_COMMENT = 60000;
const MAX_URL = 2000;
const MAX_QUERY = 240;
const DEFAULT_MAX_BYTES = 200_000;
const HARD_MAX_BYTES = 500_000;

function clip(s, n) {
  const t = String(s || '');
  return t.length <= n ? t : t.slice(0, n);
}

export function workbenchEnabled(env = process.env) {
  return ownerAutonomyEnabled(env) || env.ULTRON_WORKBENCH === '1' || env.ULTRON_WORKBENCH === 'true';
}

export function workbenchCatalog() {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'ultron-owner-workbench-catalog',
    slogan: 'Ultron works for the owner — GitHub, Actions, and the open web on demand.',
    verbs: WORKBENCH_VERBS,
    allowedDispatchWorkflows: ALLOWED_DISPATCH_WORKFLOWS,
    allowedDispatchRefs: ALLOWED_DISPATCH_REFS,
    github: {
      issues: ['list open', 'read body', 'comment', 'add labels'],
      pullRequests: ['list open', 'read', 'comment'],
      actions: ['list workflow runs', 'workflow_dispatch (allowlisted)', 'summarize job status'],
    },
    internet: {
      fetch: 'GET https only; no redirects; private host deny; streamed byte cap',
      search_plan: 'Produce structured search queries for the owner or a fetch adapter',
    },
    floors: autonomyHardFloors(),
  });
}

export function isBlockedFetchHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata' || h.endsWith('.internal')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const parts = m.slice(1).map(Number);
    if (parts.some(n => n > 255)) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.includes(':') && (h.startsWith('[') || h.includes('::'))) {
    if (/^[0-9a-f:]+$/i.test(h.replace(/^\[|\]$/g, ''))) return true;
  }
  return false;
}

export function assertSafeHttpsUrl(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return { ok: false, error: 'url-parse-failed' };
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'https-url-required' };
  if (u.username || u.password) return { ok: false, error: 'url-userinfo-forbidden' };
  if (isBlockedFetchHost(u.hostname)) return { ok: false, error: 'host-blocked-private-or-local' };
  return { ok: true, url: u.toString() };
}

export async function readResponseCapped(res, maxBytes) {
  const cl = res.headers?.get?.('content-length');
  if (cl && Number(cl) > maxBytes) {
    throw Object.assign(new Error('content-length-exceeds-cap'), { code: 'fetch-too-large' });
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return buf.subarray(0, maxBytes);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      chunks.push(chunk.subarray(0, Math.max(0, maxBytes - (total - chunk.length))));
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function planWorkbenchOp(raw = {}) {
  const verb = String(raw.verb || '').trim();
  if (!WORKBENCH_VERBS.includes(verb)) {
    return { ok: false, error: `unknown-verb:${verb || '(empty)'}` };
  }
  if (!workbenchEnabled(raw.env || process.env)) {
    return { ok: false, error: 'workbench-disabled-enable-OWNER_MODE-or-ULTRON_WORKBENCH' };
  }

  if (verb.startsWith('github.issue.') || verb.startsWith('github.pr.')) {
    const number = Number(raw.number);
    if (verb.endsWith('.list')) {
      return { ok: true, verb, args: Object.freeze({ state: raw.state === 'closed' ? 'closed' : 'open', perPage: Math.min(Number(raw.perPage) || 10, 30) }) };
    }
    if (!Number.isFinite(number) || number < 1) return { ok: false, error: 'issue-or-pr-number-required' };
    if (verb.endsWith('.comment')) {
      const body = clip(raw.body, MAX_COMMENT);
      if (!body.trim()) return { ok: false, error: 'comment-body-required' };
      return { ok: true, verb, args: Object.freeze({ number, body }) };
    }
    if (verb === 'github.issue.label') {
      const labels = Array.isArray(raw.labels) ? raw.labels.map(l => clip(l, 50)).filter(Boolean).slice(0, 10) : [];
      if (!labels.length) return { ok: false, error: 'labels-required' };
      return { ok: true, verb, args: Object.freeze({ number, labels }) };
    }
    return { ok: true, verb, args: Object.freeze({ number }) };
  }

  if (verb === 'github.actions.list_runs') {
    const workflow = clip(raw.workflow || 'verify.yml', 80);
    if (!ALLOWED_DISPATCH_WORKFLOWS.includes(workflow)) {
      return { ok: false, error: 'workflow-not-allowlisted' };
    }
    return { ok: true, verb, args: Object.freeze({ workflow, perPage: Math.min(Number(raw.perPage) || 5, 20) }) };
  }
  if (verb === 'github.actions.dispatch') {
    const workflow = clip(raw.workflow || '', 80);
    if (!workflow) return { ok: false, error: 'workflow-required' };
    if (!ALLOWED_DISPATCH_WORKFLOWS.includes(workflow)) {
      return { ok: false, error: 'workflow-not-allowlisted' };
    }
    const ref = clip(raw.ref || 'main', 80);
    if (!ALLOWED_DISPATCH_REFS.includes(ref)) {
      return { ok: false, error: 'ref-not-allowlisted' };
    }
    return { ok: true, verb, args: Object.freeze({ workflow, ref, inputs: Object.freeze({}) }) };
  }
  if (verb === 'github.actions.job_logs_summary') {
    const runId = Number(raw.runId);
    if (!Number.isFinite(runId) || runId < 1) return { ok: false, error: 'runId-required' };
    return { ok: true, verb, args: Object.freeze({ runId }) };
  }

  if (verb === 'internet.fetch') {
    const safe = assertSafeHttpsUrl(clip(raw.url, MAX_URL));
    if (!safe.ok) return { ok: false, error: safe.error };
    const maxBytes = Math.min(Number(raw.maxBytes) || DEFAULT_MAX_BYTES, HARD_MAX_BYTES);
    return { ok: true, verb, args: Object.freeze({ url: safe.url, maxBytes }) };
  }
  if (verb === 'internet.search_plan') {
    const query = clip(raw.query, MAX_QUERY);
    if (!query.trim()) return { ok: false, error: 'query-required' };
    return {
      ok: true,
      verb,
      args: Object.freeze({
        query,
        suggested: [
          `site:github.com ${query}`,
          `${query} documentation`,
          `${query} best practices 2026`,
        ],
      }),
    };
  }

  return { ok: false, error: 'unhandled-verb' };
}

export async function runWorkbenchOp(raw, adapters = {}) {
  const planned = planWorkbenchOp(raw);
  if (!planned.ok) {
    return Object.freeze({ ok: false, error: planned.error, verb: raw.verb || null });
  }
  const { verb, args } = planned;
  const started = new Date().toISOString();

  try {
    if (verb.startsWith('github.')) {
      const gh = adapters.github;
      if (!gh || typeof gh.request !== 'function') {
        return Object.freeze({ ok: false, error: 'github-adapter-missing', verb, planned: args });
      }
      const result = await gh.request(verb, args);
      return freezeResult({ ok: true, verb, args, result, started });
    }
    if (verb === 'internet.fetch') {
      const fetchFn = adapters.fetch || globalThis.fetch;
      if (typeof fetchFn !== 'function') {
        return Object.freeze({ ok: false, error: 'fetch-adapter-missing', verb, planned: args });
      }
      const safe = assertSafeHttpsUrl(args.url);
      if (!safe.ok) {
        return Object.freeze({ ok: false, error: safe.error, verb, started });
      }
      const res = await fetchFn(safe.url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          'user-agent': 'Ultron-Owner-Workbench/1.0',
          accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        },
      });
      const status = res.status;
      const buf = await readResponseCapped(res, args.maxBytes);
      const text = buf.toString('utf8');
      return freezeResult({
        ok: status >= 200 && status < 400,
        verb,
        args: { url: safe.url, maxBytes: args.maxBytes },
        result: { status, bytes: buf.length, textPreview: text.slice(0, 4000) },
        started,
      });
    }
    if (verb === 'internet.search_plan') {
      return freezeResult({ ok: true, verb, args, result: args, started });
    }
  } catch (err) {
    return Object.freeze({
      ok: false,
      verb,
      error: clip(err?.message || String(err), 300),
      started,
    });
  }
  return Object.freeze({ ok: false, error: 'unhandled', verb });
}

function freezeResult(obj) {
  const core = { ...obj, finished: new Date().toISOString() };
  return Object.freeze({
    ...core,
    fingerprint: createHash('sha256').update(JSON.stringify(core)).digest('hex'),
  });
}

export function workbenchActionHints() {
  return Object.freeze([
    'Comment `/work issue <n>` — Ultron reads and comments on that issue (owner mode).',
    'Comment `/work pr <n>` — summarize PR + CI runs.',
    'Comment `/work fetch <https-url>` — bounded HTTPS research (no redirects, no private hosts).',
    'Comment `/work dispatch verify.yml` — allowlisted workflow on main only.',
    'Enable with OWNER_MODE=1 / ULTRON_AUTONOMY=1 / ULTRON_WORKBENCH=1.',
  ]);
}
