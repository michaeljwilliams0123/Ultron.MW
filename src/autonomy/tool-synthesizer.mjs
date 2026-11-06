import { createHash } from 'node:crypto';

const TOOL_NAME = /^ultron_[a-z][a-z0-9_]{0,62}$/;
const MAX_OBJECTIVE_BYTES = 4096;
const MAX_HANDLER_BYTES = 65536;
const MAX_TEST_BYTES = 65536;

function boundedText(value, maxBytes, label) {
  if (typeof value !== 'string' || value.trim().length === 0 ||
      Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`invalid-${label}`);
  }
  return value;
}

function hash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Produces an inert, content-addressed proposal; it never runs or registers code.
 * The supplied generator is trusted application code, not a sandbox boundary.
 */
export class ToolSynthesizer {
  constructor({ generate } = {}) {
    if (typeof generate !== 'function') throw new Error('generator-required');
    this.generate = generate;
  }

  async propose({ objective } = {}) {
    boundedText(objective, MAX_OBJECTIVE_BYTES, 'objective');
    const draft = await this.generate({ objective });
    if (!draft || typeof draft !== 'object' || Array.isArray(draft) ||
        typeof draft.toolName !== 'string' || !TOOL_NAME.test(draft.toolName)) {
      throw new Error('invalid-tool-name');
    }
    const handler = boundedText(draft.handler, MAX_HANDLER_BYTES, 'handler');
    const tests = boundedText(draft.tests, MAX_TEST_BYTES, 'tests');
    const manifest = {
      schema: 'ultron.tool-proposal.v1',
      toolName: draft.toolName,
      objectiveSha256: hash(objective),
      handlerSha256: hash(handler),
      testsSha256: hash(tests)
    };
    return {
      status: 'proposed',
      manifest,
      proposalSha256: hash(JSON.stringify(manifest)),
      handler,
      tests
    };
  }
}
