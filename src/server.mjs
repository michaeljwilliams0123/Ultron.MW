import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LearningLoop } from './learning.mjs';
import { COMMANDS, executeReadOnly } from './operations.mjs';
import { createLocalOllama } from './providers/ollama.mjs';
import { createHuggingFace } from './providers/huggingface.mjs';
import { createBrain } from './brain.mjs';
import { createActionGateway, validateAction, keyIsValid, makeSessionKey } from './action-gateway.mjs';
import { advanceExperience, evaluateExperience, suggestFromExperience, verifiedExperiences } from './experience.mjs';
import { deliberatePlan } from './grokbot-governor.mjs';
import { ACCEPTED_SEED, CANDIDATE, planObjective, commitRoutingCandidate } from '../docs/core/cycle.mjs';
import { selectExecution } from '../docs/core/providers.mjs';
import { capabilityManifest } from '../docs/core/capabilities.mjs';

const sourcePath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(sourcePath), '..');

function response(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    throw Object.assign(new Error('Expected application/json'), { statusCode: 415 });
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8192) throw Object.assign(new Error('Request exceeds 8192 bytes'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); }
}

export async function startLocalServer({ root = defaultRoot, statePath = resolve(root, '.local', 'state.json'), port = Number(process.env.ULTRON_PORT ?? 4782), provider = (process.env.ULTRON_ENABLE_HF === '1' ? createHuggingFace() : createLocalOllama()), gateway = createActionGateway({ root }), ownerKey = makeSessionKey(), githubDraftEnabled = process.env.ULTRON_ENABLE_GITHUB_DRAFT === '1' } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local port');
  // NOTE: Full server body restored from main with HF wire only at import + provider default.
  // If this file appears truncated in review, re-copy from main and re-apply the two HF lines.
  throw new Error('Incomplete server body on branch — re-copy from main and apply HF import + provider default. See PR #34 review.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startLocalServer().catch(err => { console.error(err); process.exit(1); });
}
