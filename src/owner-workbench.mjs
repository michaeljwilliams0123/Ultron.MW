/**
 * Owner workbench — expanded GitHub / Actions / internet access for Ultron.
 * Gated by owner autonomy. Operations are explicit allowlisted verbs.
 *
 * This module defines the capability surface and pure planners.
 * Live HTTP/GitHub calls are injected via `adapters` so tests stay offline.
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

const MAX_COMMENT = 60000;
const MAX_URL = 2000;
const MAX_QUERY = 240;

function clip(s, n) {
  const t = String(s || '');
  return t.length <= n ? t : t.slice(0, n);
}

export function workbenchEnabled(env = process.env) {
  return ownerAutonomyEnabled(env) || env.ULTRON_WORKBENCH === '1' || env.ULTRON_WORKBENCH === 'true';
}

/** Capability catalog for docs and council action boards. */
export function workbenchCatalog() {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'ultron-owner-workbench-catalog',
    slogan: 'Ultron works for the owner — GitHub, Actions, and the open web on demand.',
    verbs: WORKBENCH_VERBS,
    github: {
      issues: ['list open', 'read body', 'comment', 'add labels'],
      pullRequests: ['list open', 'read', 'comment'],
      actions: ['list workflow runs', 'workflow_dispatch (named workflows)', 'summarize job status'],
    },
    internet: {
      fetch: 'GET https URLs only, text/html or json, size-capped',
      search_plan: 'Produce structured search queries for the owner or a fetch adapter',
    },
    floors: autonomyHardFloors(),
  });
}

/**
 * Plan a workbench operation (no side effects).
 */
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
    return { ok: true, verb, args: Object.freeze({ workflow: clip(raw.workflow || 'verify.yml', 80), perPage: Math.min(Number(raw.perPage) || 5, 20) }) };
  }
  if (verb === 'github.actions.dispatch') {
    const workflow = clip(raw.workflow || '', 80);
    if (!workflow) return { ok: false, error: 'workflow-required' };
    if (!/^[A-Za-z0-9._-]+\.ya?ml$/.test(workflow)) return { ok: false, error: 'workflow-name-invalid' };
    return { ok: true, verb, args: Object.freeze({ workflow, ref: clip(raw.ref || 'main', 80), inputs: raw.inputs && typeof raw.inputs === 'object' ? raw.inputs : {} }) };
  }
  if (verb === 'github.actions.job_logs_summary') {
    const runId = Number(raw.runId);
    if (!Number.isFinite(runId) || runId < 1) return { ok: false, error: 'runId-required' };
    return { ok: true, verb, args: Object.freeze({ runId }) };
  }

  if (verb === 'internet.fetch') {
    const url = clip(raw.url, MAX_URL);
    if (!/^https:\/\//i.test(url)) return { ok: false, error: 'https-url-required' };
    return { ok: true, verb, args: Object.freeze({ url, maxBytes: Math.min(Number(raw.maxBytes) || 200_000, 500_000) }) };
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

/**
 * Execute a planned op via injected adapters.
 */
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
      const res = await fetchFn(args.url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'Ultron-Owner-Workbench/1.0', accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
      });
      const status = res.status;
      const buf = Buffer.from(await res.arrayBuffer());
      const sliced = buf.subarray(0, args.maxBytes);
      const text = sliced.toString('utf8');
      return freezeResult({
        ok: status >= 200 && status < 400,
        verb,
        args: { url: args.url, maxBytes: args.maxBytes },
        result: { status, bytes: sliced.length, textPreview: text.slice(0, 4000) },
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
    'Comment `/work fetch <https-url>` — bounded HTTPS research preview.',
    'Comment `/work dispatch verify.yml` — workflow_dispatch on an allowlisted workflow file.',
    'Enable with OWNER_MODE=1 / ULTRON_AUTONOMY=1 / ULTRON_WORKBENCH=1.',
  ]);
}
