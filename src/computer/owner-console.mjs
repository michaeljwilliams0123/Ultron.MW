import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

/**
 * A local terminal is an owner-presence checkpoint, NOT independent account
 * authentication. It must never be used as a cloud/Actions approval service.
 * The typed field content is deliberately excluded from the approval display.
 */
export function summarizeComputerApproval(context) {
  if (!context || !/^[a-f0-9]{64}$/.test(context.planFingerprint || '') ||
      !['click', 'type', 'keypress'].includes(context.action) ||
      typeof context.planId !== 'string' || typeof context.stepId !== 'string' ||
      typeof context.selector !== 'string' || typeof context.currentOrigin !== 'string')
    throw Error('Invalid owner approval request');

  const summary = {
    objective: context.planId,
    fingerprint: context.planFingerprint,
    step: context.stepId,
    action: context.action,
    origin: context.currentOrigin,
    target: context.selector,
    expected: context.expectedState ?? null,
  };
  if (context.action === 'type') summary.valueLength = context.valueLength;
  if (context.action === 'keypress') summary.key = context.key;
  return Object.freeze(summary);
}

export function createOwnerConsoleAuthorizer({
  input = process.stdin,
  output = process.stderr,
  timeoutMs = 45000,
  makeChallenge = () => randomBytes(4).toString('hex'),
} = {}) {
  if (input?.isTTY !== true || output?.isTTY !== true)
    throw Error('Owner approval requires an interactive local terminal; no CI or pipe approval');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw Error('Owner approval timeout out of bounds');

  return async context => {
    const summary = summarizeComputerApproval(context);
    const challenge = makeChallenge();
    if (!/^[a-z0-9]{6,32}$/i.test(challenge))
      throw Error('Invalid confirmation challenge');

    output.write('\nUltron owner review (LOCAL terminal only)\n' +
      JSON.stringify(summary, null, 2) + '\n');
    const rl = createInterface({ input, output });
    try {
      const answer = await rl.question(
        'Type APPROVE ' + challenge + ' for this ONE action (anything else denies): ',
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      return answer.trim() === 'APPROVE ' + challenge;
    } catch {
      return false;
    } finally {
      rl.close();
    }
  };
}
