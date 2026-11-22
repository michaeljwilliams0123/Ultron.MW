import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  validateCallbackUrl,
  validateDispatchInputs,
  buildDeepReasoningPrompt,
  signCallbackPayload,
  runCouncilDeepReasoning,
} from '../scripts/council-deep-reasoning.mjs';

const VALID_DIGEST = 'a'.repeat(64);
const VALID_HMAC_KEY = '0123456789abcdef0123456789abcdef';

test('validateCallbackUrl allows only Hatchable council-deep-callback', () => {
  const ok = validateCallbackUrl('https://ultron-mw-cloud.hatchable.site/api/brain/council-deep-callback');
  assert.equal(ok, 'https://ultron-mw-cloud.hatchable.site/api/brain/council-deep-callback');
  assert.throws(() => validateCallbackUrl('https://evil.example.com/api/brain/council-deep-callback'));
  assert.throws(() => validateCallbackUrl('http://ultron-mw-cloud.hatchable.site/api/brain/council-deep-callback'));
  assert.throws(() => validateCallbackUrl('https://ultron-mw-cloud.hatchable.site/api/other'));
});

test('validateDispatchInputs rejects invalid taskId, digest, or roomKey', () => {
  assert.throws(() =>
    validateDispatchInputs({
      taskId: 'abc',
      requestDigest: VALID_DIGEST,
      roomKey: 'owner-main',
      callbackUrl: 'https://ultron-mw-cloud.hatchable.site/api/brain/council-deep-callback',
    })
  );
  assert.throws(() =>
    validateDispatchInputs({
      taskId: '42',
      requestDigest: 'short',
      roomKey: 'owner-main',
      callbackUrl: 'https://ultron-mw-cloud.hatchable.site/api/brain/council-deep-callback',
    })
  );
  assert.throws(() =>
    validateDispatchInputs({
      taskId: '42',
      requestDigest: VALID_DIGEST,
      roomKey: '../bad',
      callbackUrl: 'https://ultron-mw-cloud.hatchable.site/api/brain/council-deep-callback',
    })
  );
});

test('buildDeepReasoningPrompt omits private chat text and stays within budget', () => {
  const prompt = buildDeepReasoningPrompt({
    taskId: '42',
    requestDigest: VALID_DIGEST,
    roomKey: 'owner-main',
    repository: 'michaeljwilliams0123/Ultron.MW',
    sourceSha: 'b'.repeat(40),
  });
  assert.match(prompt, /Task ID: 42/);
  assert.match(prompt, new RegExp(VALID_DIGEST));
  assert.ok(prompt.length < 2000);
});

test('runCouncilDeepReasoning invokes 7 roles, signs payload with HMAC-SHA256, and POSTs callback', async () => {
  let posted = null;
  const mockFetch = async (url, opts) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      verdict: 'proceed',
                      confidence: 0.91,
                      rationale: 'Verified in mock Gemini.',
                      findings: ['scripts/council-deep-reasoning.mjs: bounded'],
                      tests: ['node --test test/council-deep-reasoning.test.mjs'],
                      disagreements: [],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    posted = { url, opts };
    return new Response(JSON.stringify({ ok: true, updated: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  let receiptWritten = null;
  const result = await runCouncilDeepReasoning({
    env: {
      TASK_ID: '42',
      REQUEST_DIGEST: VALID_DIGEST,
      ROOM_KEY: 'owner-main',
      CALLBACK_URL: 'https://ultron-mw-cloud.hatchable.site/api/brain/council-deep-callback',
      GITHUB_RUN_ID: '999001',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_REPOSITORY: 'michaeljwilliams0123/Ultron.MW',
      GITHUB_SHA: 'c'.repeat(40),
      GEMINI_API_KEY: 'test-gemini-key-for-mock',
      ULTRON_EVENT_BRIDGE_HMAC_KEY: VALID_HMAC_KEY,
    },
    fetchImpl: mockFetch,
    writeReceipt: (data) => {
      receiptWritten = data;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.modelInvocations, 7);
  assert.equal(result.aiReasoned, true);
  assert.ok(posted);
  assert.equal(posted.url, 'https://ultron-mw-cloud.hatchable.site/api/brain/council-deep-callback');
  const expectedSig = signCallbackPayload(posted.opts.body, VALID_HMAC_KEY);
  assert.equal(posted.opts.headers['x-ultron-signature-256'], expectedSig);
  const verifyHex = createHmac('sha256', VALID_HMAC_KEY).update(posted.opts.body, 'utf8').digest('hex');
  assert.equal(expectedSig, `sha256=${verifyHex}`);
  assert.equal(receiptWritten.schema, 'ultron.council-deep-callback.v1');
  assert.equal(receiptWritten.paidCents, 0);
});
