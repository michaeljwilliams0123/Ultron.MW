import { readdir } from 'node:fs/promises';
import { observeLocalSelf } from './self-observer.mjs';
import { CAPABILITIES } from '../docs/core/capabilities.mjs';

export const COMMANDS = Object.freeze(CAPABILITIES.filter(x=>x.environments.includes('local'))
  .map(({command,description})=>Object.freeze({command,description})));

export async function executeReadOnly(text, { root, learning }) {
  if (typeof text !== 'string') throw new TypeError('Command must be a string');
  const command = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!COMMANDS.some(item => item.command === command)) {
    throw Object.assign(new Error('Unknown read-only command. Use /help.'), { statusCode: 422 });
  }
  switch (command) {
    case '/help':
      return { command, summary: 'Local read-only commands available', details: COMMANDS };
    case '/system status':
      return {
        command, summary: 'Local deterministic executor is available',
        details: { runtime: 'local', provider: 'node', mode: 'read-only', cloudRequired: false, llmConnected: false, arbitraryShellAccess: false },
      };
    case '/repo inspect': {
      const allowed = ['src', 'docs', 'test', 'README.md', '.github'];
      const entries = await readdir(root, { withFileTypes: true });
      const present = entries.filter(item => allowed.includes(item.name)).map(item => ({
        name: item.name, kind: item.isDirectory() ? 'directory' : 'file',
      }));
      return { command, summary: 'Local repository structure inspected', details: { inspectedRoot: 'Ultron project', present, inspectedCount: present.length } };
    }
    case '/self scan': {
      const details = await observeLocalSelf({root});
      return {command,summary:'Local Ultron operational self-scan completed; live runtime readiness remains unverified',details};
    }
    case '/learning status':
      {
        const observations = Number.isSafeInteger(learning?.observationCount)
          ? learning.observationCount : learning?.observations?.length || 0;
        const candidates = Number.isSafeInteger(learning?.candidateCount)
          ? learning.candidateCount : learning?.candidates?.length || 0;
        const promotions = Number.isSafeInteger(learning?.promotionCount)
          ? learning.promotionCount : learning?.history?.filter(item =>
            item.action === 'promote').length || 0;
        return {
          command, summary: 'Evidence ledger inspected',
          details: {
            acceptedVersion: learning?.acceptedVersion || learning?.accepted || 'baseline',
            routingVersion: learning?.routingVersion || null,
            observationCount: observations,
            candidateCount: candidates,
            promotionCount: promotions,
          },
        };
      }
  }
}
