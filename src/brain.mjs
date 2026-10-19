import { COMMANDS, executeReadOnly } from './operations.mjs';

// One coordinator, at most two local model calls and one read-only tool per turn.
const SYSTEM = [
  'You are Ultron, a local-only, single-owner cognitive coordinator.',
  'Return only JSON, no markdown and no extra keys.',
  'Either {"action":"reply","text":"your useful response"} or {"action":"tool","command":"/help"} using one of the allowed commands.',
  'Never invent tool results or claim to have performed an action you did not perform.',
  'You cannot execute shell commands, edit files, send messages or use cloud services.',
  'Available read-only commands: ' + COMMANDS.map(item => item.command).join(', '),
].join('\n');

function validateDecision(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Invalid structured model decision'), { statusCode: 502 });
  }
  if (value.action === 'reply' && typeof value.text === 'string' && value.text.trim() &&
    value.text.length <= 4000) return { action: 'reply', text: value.text.trim() };
  if (value.action === 'tool' && typeof value.command === 'string' &&
    COMMANDS.some(item => item.command === value.command)) return { action: 'tool', command: value.command };
  throw Object.assign(new Error('Local model chose an unsupported action'), { statusCode: 422 });
}

export function createBrain({ provider, root, snapshot }) {
  if (!provider || typeof provider.respond !== 'function' || typeof provider.status !== 'function') {
    throw new Error('A local model provider is required');
  }
  return {
    status: () => provider.status(),
    async think(text) {
      if (typeof text !== 'string' || !text.trim() || text.length > 1200) {
        throw Object.assign(new Error('Objective must be 1–1200 characters'), { statusCode: 400 });
      }
      const first = await provider.respond([
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text.trim() },
      ]);
      const decision = validateDecision(first.decision);
      if (decision.action === 'reply') {
        return { text: decision.text, model: first.model, toolResult: null };
      }
      const toolResult = await executeReadOnly(decision.command, { root, learning: snapshot().learning });
      const second = await provider.respond([
        { role: 'system', content: SYSTEM + '\nA read-only command already ran. Reply ONLY with action=reply and factual summary based on the provided tool result.' },
        { role: 'user', content: text.trim() },
        { role: 'user', content: 'Read-only tool output (verified by Ultron runtime): ' + JSON.stringify(toolResult) },
      ]);
      const response = validateDecision(second.decision);
      if (response.action !== 'reply') {
        throw Object.assign(new Error('Local model attempted a second tool action'), { statusCode: 422 });
      }
      return { text: response.text, model: second.model, toolResult };
    },
  };
}
