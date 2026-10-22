import { createHash } from 'node:crypto';

/**
 * Stagehand v4 is a source of proposed browser targets, not an authority.
 * The guarded driver always routes through Ultron's existing action executor.
 */
const ACTIONS = new Set(['navigate','click','type','extract','observe','wait','scroll']);
const INTERACTIVE = new Set(['click','type']);
const sha256 = text => createHash('sha256').update(text).digest('hex');
const canonicalOrigin = value => {
  try {
    const u = new URL(value);
    return u.origin === value && !u.username && !u.password &&
      (u.protocol === 'https:' ||
        u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname));
  } catch { return false; }
};
const safeSelector = selector =>
  typeof selector === 'string' && selector.length >= 1 && selector.length <= 240 &&
  !/[\u0000-\u001f]/.test(selector) &&
  !/(javascript:|data:|file:|https?:\/\/)/i.test(selector);

/**
 * Take an ephemeral fingerprint of the exact DOM target and document URL.
 * The outerHTML is hashed in-process and never returned or persisted.
 * A replaced or modified node requires a new AI observation.
 */
async function targetIdentity(page, selector) {
  if (!safeSelector(selector) || await page.locator(selector).count() !== 1)
    return null;
  const url = String(await page.url());
  const node = await page.evaluate(value => {
    let element;
    try {
      element = value.startsWith('xpath=')
        ? document.evaluate(value.slice(6),document,null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue
        : document.querySelector(value);
    } catch { return null; }
    if (!element || !element.isConnected || element.disabled) return null;
    return {
      tag: element.tagName,
      type: String(element.getAttribute('type') || '').toLowerCase(),
      contenteditable: element.getAttribute('contenteditable'),
      // Never persist an untrusted node's HTML. It only enters a digest.
      html: element.outerHTML,
    };
  }, selector);
  if (!node || typeof node.html !== 'string') return null;
  return Object.freeze({ url, ...{
    fingerprint: sha256(JSON.stringify({url, node})),
    tag: node.tag, type: node.type, contenteditable: node.contenteditable,
  } });
}

/** Adapt a Stagehand v4 Page, including its asynchronously returned URL.
 * Interactive actions fail closed unless a fresh selector-proposal verifier
 * confirms the same page and target immediately before dispatch. */
export function createStagehandPageDriver(page, { verifyTarget } = {}) {
  if (!page || typeof page.goto !== 'function' ||
      typeof page.locator !== 'function' || typeof page.url !== 'function')
    throw Error('Stagehand v4 Page is required');
  return Object.freeze({
    async observe(expect = {}) {
      const fullText = String(await page.locator('body').innerText());
      const prefix = fullText.slice(0, 9000);
      let excerpt = '';
      const needle = expect?.textIncludes;
      if (typeof needle === 'string' && needle &&
          !prefix.includes(needle)) {
        const index = fullText.indexOf(needle);
        if (index >= 0) excerpt = fullText.slice(Math.max(0,index-180),index+needle.length+180);
      }
      return {
        url: String(await page.url()),
        title: String(await page.title()).slice(0,240),
        text: (prefix + (excerpt ? '\n[verified excerpt]\n' + excerpt : '')).slice(0,10000),
        // A full-page digest detects tail-only changes without exposing the
        // full content in receipts or leaving it in durable checkpoints.
        textDigest: sha256(fullText),
      };
    },
    async perform(step) {
      if (!ACTIONS.has(step?.action)) throw Error('Unsupported Stagehand computer action');
      if (INTERACTIVE.has(step.action) &&
          (typeof verifyTarget !== 'function' || await verifyTarget(step) !== true))
        throw Error('Stagehand target stale or not independently verified');
      switch(step.action) {
        case 'navigate':
          await page.goto(step.url); return null;
        case 'click':
          await page.locator(step.selector).click(); return null;
        case 'type': {
          const loc = page.locator(step.selector);
          await loc.fill(step.value);
          return { fieldValueVerified: await loc.inputValue() === step.value };
        }
        case 'extract':
          return { text: String(await page.locator(step.selector).innerText()).slice(0,10000) };
        case 'wait':
          await page.waitForSelector(step.selector,{timeout:step.timeoutMs}); return null;
        case 'scroll':
          await page.evaluate(pixels => window.scrollBy(0,pixels),step.pixels); return null;
        case 'observe':
          return null;
      }
    }
  });
}

/**
 * Ask Stagehand to suggest a selector, validate it against the current DOM,
 * then retain only a hashed identity. No model can approve its own action.
 */
export function createStagehandSelectorObserver({ agent, page, allowedOrigins }) {
  if (!agent || typeof agent.observe !== 'function' ||
      !page || typeof page.locator !== 'function' ||
      typeof page.evaluate !== 'function' || typeof page.url !== 'function' ||
      !Array.isArray(allowedOrigins) || !allowedOrigins.length ||
      allowedOrigins.some(x => !canonicalOrigin(x)))
    throw Error('Stagehand observation requires a bounded, canonical origin policy');
  const validated = new Map();
  const keyFor = (action, selector) => JSON.stringify([action, selector]);
  return Object.freeze({
    async suggest({ instruction, action }) {
      if (typeof instruction !== 'string' || instruction.length < 3 ||
          instruction.length > 400 || !INTERACTIVE.has(action))
        throw Error('Invalid untrusted observation request');
      const before = new URL(String(await page.url()));
      if (!allowedOrigins.includes(before.origin))
        throw Error('Stagehand observation not allowed on this origin');
      const observations = await agent.observe(instruction);
      const options = Array.isArray(observations?.data) ? observations.data.slice(0,10) : [];
      for (const candidate of options) {
        if (!safeSelector(candidate?.selector)) continue;
        const method = String(candidate.method || '').toLowerCase();
        if (action === 'click' && !method.includes('click') ||
            action === 'type' && !['fill','type','input'].some(x=>method.includes(x)))
          continue;
        const identity = await targetIdentity(page, candidate.selector);
        if (!identity) continue;
        if (action === 'type' && !['INPUT','TEXTAREA'].includes(identity.tag) &&
            identity.contenteditable !== 'true') continue;
        if (action === 'click' && !['BUTTON','A','INPUT'].includes(identity.tag)) continue;
        const after = new URL(String(await page.url()));
        if (after.origin !== before.origin)
          throw Error('Origin changed during Stagehand observation');
        validated.set(keyFor(action, candidate.selector), identity);
        return Object.freeze({
          selector:candidate.selector, action,
          origin:before.origin, evidence:'single-DOM-element',
        });
      }
      throw Error('No verified Stagehand selector candidate');
    },
    async verifyTarget({ action, selector }) {
      const saved = validated.get(keyFor(action,selector));
      if (!saved) return false;
      if (!allowedOrigins.includes(new URL(saved.url).origin)) return false;
      const current = await targetIdentity(page,selector);
      return !!current && current.url === saved.url &&
        current.fingerprint === saved.fingerprint;
    },
  });
}

/**
 * Ollama's existing native adapter owns the local-only HTTP connection.
 * This wrapper adapts its structured decision to Stagehand's ModelClient
 * contract; no new model/provider account or credential is introduced.
 */
export function createStagehandOllamaModel(localOllama) {
  if (!localOllama || typeof localOllama.respond !== 'function')
    throw Error('Enabled local Ollama adapter required');
  return Object.freeze({
    async generate({ systemPrompt = '', messages = [], responseFormat } = {}) {
      if (typeof systemPrompt !== 'string' || systemPrompt.length > 18000 ||
          !Array.isArray(messages) || messages.length > 12)
        throw Error('Model context exceeds local limits');
      const normalize = value => {
        const parts = Array.isArray(value) ? value : [value];
        return parts.map(part => {
          if (typeof part === 'string') return part;
          if (part?.type === 'text' && typeof part.text === 'string') return part.text;
          throw Error('Non-text Stagehand context requires a separate visual model');
        }).join('\n');
      };
      const formatted = [
        { role:'system', content:
          systemPrompt + '\nReturn exactly a JSON object. Match the required structured response schema; never add explanatory prose.' +
          (responseFormat?.schema ? '\nRequired schema: '+JSON.stringify(responseFormat.schema).slice(0,14000) : '') },
        ...messages.map(m=>({role:m.role === 'assistant' ? 'assistant' : 'user',
          content:normalize(m.content)}))
      ];
      if (formatted.some(m=>m.content.length > 24000))
        throw Error('Local inference context too large');
      const response = await localOllama.respond(formatted);
      const decision = response?.decision;
      if (!decision || typeof decision !== 'object' || Array.isArray(decision))
        throw Error('Local model produced no structured object');
      return {
        role:'assistant',
        content:{type:'text',text:JSON.stringify(decision)},
        outputFormat:'json_schema',
        structuredContent:decision,
      };
    }
  });
}

/** Optional LangGraph state snapshot factory; never supersedes Ultron's
 * independent pending-action/approval journal or multi-process lock. */
export function createOptionalSqliteGraphCheckpointer({ SqliteSaver, databasePath }) {
  if (!SqliteSaver || typeof SqliteSaver.fromConnString !== 'function' ||
      typeof databasePath !== 'string' || !databasePath ||
      databasePath === ':memory:')
    throw Error('Durable SQLite saver and explicit database path required');
  return SqliteSaver.fromConnString(databasePath);
}
