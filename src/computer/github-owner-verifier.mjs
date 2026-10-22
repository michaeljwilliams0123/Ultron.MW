import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

/**
 * Use the OS credential store through the official GitHub CLI to independently
 * validate the GitHub account bound to the local operator host.
 *
 * This verifies the HOST's existing GitHub identity, NOT browser cookies or
 * a user's presence. No GitHub token, header or profile is sent to Playwright.
 * The calling host still requires separate human approval for interactive
 * actions and a fresh external-account login when the target site needs one.
 */
export function createGitHubCliOwnerVerifier({
  ownerLogin, run = exec,
} = {}) {
  if (!LOGIN.test(ownerLogin || ''))
    throw Error('Explicit GitHub owner login is required');
  return async function verifyOwner() {
    try {
      const { stdout } = await run('gh', [
        'api', '--hostname', 'github.com', '--method', 'GET',
        '/user', '--jq', '.login',
      ], {
        timeout: 10000, windowsHide: true, maxBuffer: 2048,
      });
      return String(stdout).trim().toLowerCase() === ownerLogin.toLowerCase();
    } catch {
      return false;
    }
  };
}
