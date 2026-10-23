import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

/**
 * A local terminal is an owner-presence checkpoint, NOT independent account
 * authentication. It must never be used as a cloud/Actions approval service.
 * Approval summaries never display typed field contents or expected assertion
 * values, which themselves may contain passwords or other private data.
 * @param {object} context Normalized action metadata supplied by the executor.
 * @returns {Readonly<object>} A display-safe, bounded approval preview.
 */
export function summarizeComputerApproval(context) {
  if (!context || !/^[a-f0-9]{64}$/.test(context.planFingerprint || '') ||
      !['click', 'type', 'keypress', 'upload', 'download'].includes(context.action) ||
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
    // Expectations may contain an input value even if context.value is omitted.
    // Show assertion types only; the plan fingerprint binds the exact values.
    expected: context.expectedState ? Object.fromEntries(
      Object.keys(context.expectedState)
        .filter(key => ['urlIncludes', 'textIncludes'].includes(key))
        .map(key => [key, '[redacted]']),
    ) : null,
  };
  if (context.action === 'click' && context.uploadDestination !== undefined) {
    const url = new URL(context.uploadDestination);
    if (url.origin !== context.uploadDestination || url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))
      throw Error('Unapproved upload destination origin');
    summary.uploadDestination = url.origin;
  }
  if (context.action === 'type') summary.valueLength = context.valueLength;
  if (['upload','download'].includes(context.action)) {
    if (typeof context.fileName !== 'string' || context.fileName.length > 80)
      throw Error('File action requires a bounded filename preview');
    summary.fileName = context.fileName;
    summary.risk = context.action === 'upload' ? 'send-owner-approved-file' : 'write-owner-approved-local-file';
  }
  if (context.action === 'keypress') summary.key = context.key;
  return Object.freeze(summary);
}

/**
 * Request local per-action approval; reject CI even if it offers a pseudo-TTY.
 * A TTY challenge proves user presence, not cryptographic owner identity.
 * @param {object} options Console streams, environment and challenge settings.
 * @returns {(context: object) => Promise<boolean>} One-time action decision.
 */
export function createOwnerConsoleAuthorizer({
  input = process.stdin,
  output = process.stderr,
  environment = process.env,
  timeoutMs = 45000,
  makeChallenge = () => randomBytes(4).toString('hex'),
} = {}) {
  // A CI job can allocate a pseudo-terminal. Fail closed on CI provenance as
  // well as redirected input. This does not replace independent owner auth.
  const CI_MARKERS = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TF_BUILD',
    'JENKINS_URL', 'BUILDKITE', 'CIRCLECI', 'TRAVIS', 'TEAMCITY_VERSION',
    'BITBUCKET_BUILD_NUMBER'];
  if (!environment || typeof environment !== 'object' ||
      CI_MARKERS.some(key => Object.hasOwn(environment, key)))
    throw Error('Owner approval refuses CI execution, even with a pseudo-terminal');
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
