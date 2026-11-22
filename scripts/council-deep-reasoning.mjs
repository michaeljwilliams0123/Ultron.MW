#!/usr/bin/env node
/**
 * Ultron Council Deep Reasoning runner for GitHub Actions workflow_dispatch.
 * Invokes the 7-role Gemini 3.5 Flash-Lite + Groq GPT-OSS Council engine ($0 free tier)
 * without copying private chat text into public GitHub issues, signs the JSON result
 * with HMAC-SHA256, and POSTs it to Hatchable's /api/brain/council-deep-callback.
 */
import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runReasoningRound, REASONING_ROLES } from '../src/council-reasoning.mjs';

const REPO = 'michaeljwilliams0123/Ultron.MW';
const TASK_ID_RE = /^[1-9][0-9]{0,15}$/;
const HEX64_RE = /^[a-f0-9]{64}$/;
const ROOM_RE = /^(?:owner-main|chat-[a-f0-9-]{36})$/;
const SHA40_RE = /^[a-f0-9]{40}$/;
const ALLOWED_CALLBACK_ORIGIN = 'https://ultron-mw-cloud.hatchable.site';
const ALLOWED_CALLBACK_PATH = '/api/brain/council-deep-callback';

export function validateCallbackUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    throw Error('callback-url-invalid');
  }
  if (parsed.origin !== ALLOWED_CALLBACK_ORIGIN || parsed.pathname !== ALLOWED_CALLBACK_PATH) {
    throw Error('callback-url-not-allowed');
  }
  return parsed.toString();
}

export function validateDispatchInputs({ taskId, requestDigest, roomKey, callbackUrl }) {
  const cleanTaskId = String(taskId ?? '').trim();
  const cleanDigest = String(requestDigest ?? '').trim().toLowerCase();
  const cleanRoom = String(roomKey ?? '').trim();
  if (!TASK_ID_RE.test(cleanTaskId)) throw Error('task-id-invalid');
  if (!HEX64_RE.test(cleanDigest)) throw Error('request-digest-invalid');
  if (!ROOM_RE.test(cleanRoom)) throw Error('room-key-invalid');
  const cleanCallbackUrl = validateCallbackUrl(callbackUrl);
  return {
    taskId: cleanTaskId,
    requestDigest: cleanDigest,
    roomKey: cleanRoom,
    callbackUrl: cleanCallbackUrl,
  };
}

export function buildDeepReasoningPrompt({ taskId, requestDigest, roomKey, repository, sourceSha }) {
  const sha = SHA40_RE.test(String(sourceSha || '')) ? sourceSha : 'unknown';
  return [
    'Ultron Council Deep Reasoning Dispatch',
    `Repository: ${repository || REPO}`,
    `Main SHA: ${sha}`,
    `Task ID: ${taskId}`,
    `Room Key: ${roomKey}`,
    `Request Digest: ${requestDigest}`,
    'Mode: deep ($0 free-tier 7-role council deliberation; no private chat text)',
    'Instructions: Provide each Council role assessment (verdict, confidence, rationale, findings, tests, disagreements) grounded in repository architecture, authority boundaries, and exact-head verification discipline.',
  ].join('\n');
}

export function signCallbackPayload(rawBody, hmacKey) {
  if (typeof hmacKey !== 'string' || Buffer.byteLength(hmacKey, 'utf8') < 32) {
    throw Error('hmac-key-unconfigured');
  }
  const hex = createHmac('sha256', hmacKey).update(rawBody, 'utf8').digest('hex');
  return `sha256=${hex}`;
}

export async function runCouncilDeepReasoning({
  env = process.env,
  fetchImpl = fetch,
  writeReceipt = (data) => writeFileSync('council-deep-result.json', JSON.stringify(data, null, 2)),
} = {}) {
  const inputs = validateDispatchInputs({
    taskId: env.TASK_ID,
    requestDigest: env.REQUEST_DIGEST,
    roomKey: env.ROOM_KEY,
    callbackUrl: env.CALLBACK_URL || `${ALLOWED_CALLBACK_ORIGIN}${ALLOWED_CALLBACK_PATH}`,
  });
  const repository = String(env.GITHUB_REPOSITORY || REPO);
  const sourceSha = SHA40_RE.test(String(env.GITHUB_SHA || '')) ? env.GITHUB_SHA : '';
  const runId = String(env.GITHUB_RUN_ID || '0');
  const runAttempt = String(env.GITHUB_RUN_ATTEMPT || '1');
  const runUrl = /^\d+$/.test(runId) && runId !== '0'
    ? `https://github.com/${repository}/actions/runs/${runId}`
    : null;

  const input = buildDeepReasoningPrompt({
    ...inputs,
    repository,
    sourceSha,
  });

  const deterministic = Object.fromEntries(
    Object.keys(REASONING_ROLES).map((role) => [
      role,
      {
        verdict: 'hold',
        confidence: 0.35,
        rationale: `${role} deep reasoning fell back to deterministic mode because free-tier model credentials were unavailable or rate-limited.`,
        findings: [],
        tests: [],
        disagreements: [],
      },
    ])
  );

  const reasoning = await runReasoningRound({
    input,
    env,
    fetchImpl,
    deterministic,
  });

  const payload = {
    schema: 'ultron.council-deep-callback.v1',
    taskId: inputs.taskId,
    requestDigest: inputs.requestDigest,
    roomKey: inputs.roomKey,
    runId,
    runAttempt,
    runUrl,
    sourceSha: sourceSha || null,
    at: new Date().toISOString(),
    modelInvocations: reasoning.modelInvocations,
    aiReasoned: reasoning.aiReasoned,
    disagreement: reasoning.disagreement,
    verdicts: reasoning.verdicts,
    results: reasoning.results,
    summary: `Deep reasoning completed (${reasoning.modelInvocations}/7 model-backed roles; disagreement=${reasoning.disagreement}).`,
    paidCents: 0,
  };

  writeReceipt(payload);

  const rawBody = JSON.stringify(payload);
  const signature = signCallbackPayload(rawBody, env.ULTRON_EVENT_BRIDGE_HMAC_KEY);
  const deliveryId = `council-deep-${inputs.taskId}-${runId}-${runAttempt}`;

  const response = await fetchImpl(inputs.callbackUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ultron-signature-256': signature,
      'x-ultron-delivery': deliveryId,
      'user-agent': 'UltronMW-Council-Deep-Reasoning/1.0',
    },
    body: rawBody,
    signal: AbortSignal.timeout(15000),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw Error(`callback-failed-${response.status}: ${responseText.slice(0, 200)}`);
  }

  let callbackResponse = null;
  try {
    callbackResponse = JSON.parse(responseText);
  } catch {
    callbackResponse = { raw: responseText.slice(0, 200) };
  }

  return {
    ok: true,
    taskId: inputs.taskId,
    modelInvocations: reasoning.modelInvocations,
    aiReasoned: reasoning.aiReasoned,
    callbackStatus: response.status,
    callbackResponse,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCouncilDeepReasoning()
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((err) => {
      console.error(err?.message || String(err));
      process.exit(1);
    });
}
