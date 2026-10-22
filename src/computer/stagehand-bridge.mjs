/**
 * Stagehand v4 compatibility port for the existing Ultron computer executor.
 * A model can suggest selectors, but this port NEVER calls agent.act().
 * Every action must pass through createBoundComputerExecutor and owner policy.
 */
const ACTIONS = new Set(['navigate','click','type','extract','observe','wait','scroll']);
const canonicalOrigin = value => {
  try {
    const u = new URL(value);
    return u.origin === value && !u.username && !u.password &&
      (u.protocol === 'https:' ||
        u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname));
  } catch { return false; }
};

export function createStagehandPageDriver(page) {
  if (!page || typeof page.goto !== 'function' ||
      typeof page.locator !== 'function' || typeof page.url !== 'function')
    throw Error('Stagehand v4 Page is required');
  return Object.freeze({
    async observe() {
      return {
        url: String(await page.url()),
        title: String(await page.title()).slice(0,240),
        text: String(await page.locator('body').innerText()).slice(0,10000),
      };
    },
    async perform(step) {
      if (!ACTIONS.has(step?.action)) throw Error('Unsupported Stagehand computer action');
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

const safeSelector = selector =>
  typeof selector === 'string' && selector.length >= 1 && selector.length <= 240 &&
  !/[\u0000-\u001f]/.test(selector) &&
  !/(javascript:|data:|file:|https?:\/\/)/i.test(selector);

/**
 * Returns a *proposal*, never an instruction to execute. DOM confirmation
 * checks the model's proposed selector targets exactly one supported element.
 */
export function createStagehandSelectorObserver({ agent, page, allowedOrigins }) {
  if (!agent || typeof agent.observe !== 'function' ||
      !page || typeof page.locator !== 'function' ||
      typeof page.evaluate !== 'function' || typeof page.url !== 'function' ||
      !Array.isArray(allowedOrigins) || !allowedOrigins.length ||
      allowedOrigins.some(x => !canonicalOrigin(x)))
    throw Error('Stagehand observation requires a bounded, canonical origin policy');
  return Object.freeze({
    async suggest({ instruction, action }) {
      if (typeof instruction !== 'string' || instruction.length < 3 ||
          instruction.length > 400 || !['click','type'].includes(action))
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
        if (await page.locator(candidate.selector).count() !== 1) continue;
        const shape = await page.evaluate(selector => {
          let el;
          try {
            el = selector.startsWith('xpath=')
              ? document.evaluate(selector.slice(6),document,null,
                  XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue
              : document.querySelector(selector);
          } catch { return null; }
          if (!el) return null;
          return {
            tag: el.tagName, type: String(el.getAttribute('type')||'').toLowerCase(),
            disabled: Boolean(el.disabled), contenteditable: el.getAttribute('contenteditable'),
          };
        },candidate.selector);
        if (!shape || shape.disabled) continue;
        if (action === 'type' && !['INPUT','TEXTAREA'].includes(shape.tag) &&
            shape.contenteditable !== 'true') continue;
        if (action === 'click' && !['BUTTON','A','INPUT'].includes(shape.tag)) continue;
        const after = new URL(String(await page.url()));
        if (after.origin !== before.origin)
          throw Error('Origin changed during Stagehand observation');
        return Object.freeze({
          selector:candidate.selector, action,
          origin:before.origin, evidence:'single-DOM-element',
        });
      }
      throw Error('No verified Stagehand selector candidate');
    }
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
