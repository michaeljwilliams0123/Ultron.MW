/**
 * Ultron outer-loop orchestrator (cleaned architecture).
 *
 * Maps enterprise “Grok-style bot script” ideas onto Ultron’s real stack:
 * - State isolation per session (no global message arrays)
 * - Sliding context window
 * - Structured plan schema (JSON, not free-form)
 * - Tool dispatch via owner-workbench verbs (injected adapters)
 * - Optional inference adapter (local/HF/xAI) — never hardcoded keys
 * - Human-in-the-loop flag on plans that require owner approval
 *
 * This is NOT the consumer “Grok Bot” cloud product. It is Ultron’s
 * deterministic + optional-model outer loop for owner-directed work.
 */
import { createHash } from 'node:crypto';
import { runWorkbenchOp, workbenchEnabled } from './owner-workbench.mjs';
import { deliberatePlan } from './grokbot-governor.mjs';
import { buildInterSelfDialogue } from './inter-self-dialogue.mjs';
import { ownerAutonomyEnabled } from './owner-autonomy.mjs';

const MAX_HISTORY = 24;
const MAX_CONTENT = 4000;
const MAX_STEPS = 12;

function clip(s, n = MAX_CONTENT) {
  const t = String(s ?? '');
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}

/**
 * Validate / normalize a structured execution plan.
 */
export function normalizeExecutionPlan(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'plan-not-object' };
  const summary = clip(raw.summary || '', 500).trim();
  if (!summary) return { ok: false, error: 'summary-required' };
  if (!Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > MAX_STEPS) {
    return { ok: false, error: 'steps-1-to-12-required' };
  }
  const steps = [];
  for (let i = 0; i < raw.steps.length; i++) {
    const s = raw.steps[i];
    if (!s || typeof s !== 'object') return { ok: false, error: `step-${i}-invalid` };
    const id = clip(s.id || `step-${i + 1}`, 64);
    const action = clip(s.action || '', 80);
    if (!action) return { ok: false, error: `step-${i}-action-required` };
    steps.push(Object.freeze({
      id,
      action,
      args: s.args && typeof s.args === 'object' ? Object.freeze({ ...s.args }) : Object.freeze({}),
    }));
  }
  return {
    ok: true,
    plan: Object.freeze({
      summary,
      steps: Object.freeze(steps),
      technical_payload: clip(raw.technical_payload || '', 2000),
      requires_human_approval: Boolean(raw.requires_human_approval),
    }),
  };
}

/**
 * Isolated session state for one owner conversation / job.
 */
export class OuterLoopSession {
  constructor(opts = {}) {
    this.sessionId = clip(opts.sessionId || `sess-${Date.now()}`, 80);
    this.maxHistory = Number.isFinite(opts.maxHistory) ? Math.min(opts.maxHistory, 64) : MAX_HISTORY;
    this.history = [
      {
        role: 'system',
        content: clip(
          opts.systemPrompt ||
            'You are Ultron outer-loop: owner-first, advisory by default, workbench tools only when enabled.',
          2000,
        ),
      },
    ];
    this.events = [];
  }

  slideContextWindow() {
    if (this.history.length <= this.maxHistory) return;
    const system = this.history[0];
    const tail = this.history.slice(-(this.maxHistory - 1));
    this.history = [system, ...tail];
  }

  append(role, content) {
    this.history.push({ role, content: clip(content) });
    this.slideContextWindow();
  }

  councilAdvise(task, options = {}) {
    const plan = {
      objective: clip(task, 200),
      strategy: 'routing-v2',
      status: 'ready',
      steps: [{ index: 0, command: '/repo inspect', kind: 'read-only', status: 'ready' }],
      executable: true,
      mode: 'read-only',
      autonomous: false,
    };
    const receipt = deliberatePlan(plan, {
      evidenceCoverage: options.evidenceCoverage ?? 0.85,
      calibratedConfidence: options.calibratedConfidence ?? 0.8,
      knownUnknowns: options.knownUnknowns || [],
      materialConflictCount: options.materialConflictCount || 0,
      observedAt: options.observedAt || new Date().toISOString(),
    });
    const dialogue = buildInterSelfDialogue({
      mode: 'active',
      objective: task,
      decision: receipt.decision,
      dissent: options.knownUnknowns || [],
      observedAt: options.observedAt || new Date().toISOString(),
    });
    const event = Object.freeze({
      kind: 'council-advise',
      decision: receipt.decision,
      fingerprint: receipt.fingerprint,
      dialogueTurns: dialogue.turnCount,
    });
    this.events.push(event);
    this.append('assistant', `council:${receipt.decision}:${receipt.fingerprint.slice(0, 12)}`);
    return Object.freeze({ receipt, dialogue, event });
  }

  async executePlan(rawPlan, adapters = {}, env = process.env) {
    const normalized = normalizeExecutionPlan(rawPlan);
    if (!normalized.ok) {
      return Object.freeze({ ok: false, error: normalized.error });
    }
    const { plan } = normalized;
    if (plan.requires_human_approval && !adapters.ownerApproved) {
      return Object.freeze({
        ok: false,
        error: 'human-approval-required',
        plan,
        hint: 'Set adapters.ownerApproved=true after explicit owner confirmation.',
      });
    }

    const stepResults = [];
    for (const step of plan.steps) {
      const action = step.action;
      if (action.startsWith('github.') || action.startsWith('internet.')) {
        if (!workbenchEnabled(env) && !ownerAutonomyEnabled(env)) {
          stepResults.push(Object.freeze({ id: step.id, ok: false, error: 'workbench-disabled' }));
          continue;
        }
        const out = await runWorkbenchOp(
          { verb: action, ...step.args, env },
          adapters,
        );
        stepResults.push(Object.freeze({ id: step.id, ...out }));
        continue;
      }
      if (typeof adapters.custom === 'function') {
        const out = await adapters.custom(step, { session: this, env });
        stepResults.push(Object.freeze({ id: step.id, ok: Boolean(out?.ok), result: out }));
        continue;
      }
      stepResults.push(Object.freeze({ id: step.id, ok: false, error: `unknown-action:${action}` }));
    }

    const ok = stepResults.every(s => s.ok);
    const core = {
      ok,
      sessionId: this.sessionId,
      plan,
      stepResults,
      finished: new Date().toISOString(),
    };
    const result = Object.freeze({
      ...core,
      fingerprint: createHash('sha256').update(JSON.stringify(core)).digest('hex'),
    });
    this.events.push(Object.freeze({ kind: 'execute-plan', fingerprint: result.fingerprint, ok }));
    this.append('assistant', `plan:${plan.summary}:ok=${ok}`);
    return result;
  }

  async inferTurn(adapters = {}, { maxRetries = 3, baseDelayMs = 400 } = {}) {
    if (typeof adapters.infer !== 'function') {
      return Object.freeze({ ok: false, error: 'infer-adapter-missing' });
    }
    this.slideContextWindow();
    let delay = baseDelayMs;
    let lastErr = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await adapters.infer({
          messages: this.history.map(m => ({ role: m.role, content: m.content })),
          sessionId: this.sessionId,
        });
        const content = clip(response?.content || '');
        this.append('assistant', content);
        return Object.freeze({ ok: true, content, attempt: attempt + 1 });
      } catch (err) {
        lastErr = err;
        const status = err?.status || err?.statusCode;
        const retryable = status === 429 || status === 503 || status === 502;
        if (!retryable || attempt === maxRetries - 1) break;
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
    return Object.freeze({
      ok: false,
      error: clip(lastErr?.message || String(lastErr) || 'infer-failed', 300),
    });
  }

  snapshot() {
    return Object.freeze({
      sessionId: this.sessionId,
      historyLength: this.history.length,
      events: this.events.slice(),
    });
  }
}

export function planFromWorkbenchVerb(verb, args = {}) {
  return {
    summary: `Workbench: ${verb}`,
    steps: [{ id: 'w1', action: verb, args }],
    requires_human_approval: false,
    technical_payload: '',
  };
}
