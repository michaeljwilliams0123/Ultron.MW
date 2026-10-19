/**
 * Optional WebGPU-only inference. This module runs inside the browser, not
 * Node.js, Cloudflare, or a GitHub Action.
 *
 * The library, model weights, and WASM download only after a direct click.
 * Prompts are not sent to a server by Ultron and are never persisted here.
 */
export const BROWSER_MODEL_ID = 'SmolLM2-360M-Instruct-q4f32_1-MLC';
export const WEBLLM_MODULE_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.86';

const SYSTEM_PROMPT = [
  'You are Ultron, an on-device assistant running only in this browser.',
  'Provide concise and useful reasoning, and distinguish guesses from evidence.',
  'You have no access to the filesystem, GitHub, remote services, or any tools.',
  'Never claim to have inspected, executed, deployed, changed, or remembered anything outside this chat session.',
].join(' ');

export function createBrowserBrain({
  gpu = () => globalThis.navigator?.gpu,
  loadModule = () => import(WEBLLM_MODULE_URL),
  modelId = BROWSER_MODEL_ID,
} = {}) {
  let engine = null;
  let initialization = null;
  let requests = Promise.resolve();

  async function capability() {
    try {
      const webgpu = gpu();
      if (!webgpu?.requestAdapter) return { available: false, reason: 'WebGPU is not available in this browser.' };
      const adapter = await webgpu.requestAdapter();
      if (!adapter) return { available: false, reason: 'This device has no usable WebGPU adapter.' };
      return { available: true, reason: null };
    } catch {
      return { available: false, reason: 'This device cannot start a WebGPU adapter.' };
    }
  }

  function ready() { return engine !== null; }

  async function enable(onProgress = () => {}) {
    if (ready()) return { model: modelId, ready: true };
    if (initialization) return initialization;
    initialization = (async () => {
      const support = await capability();
      if (!support.available) throw new Error(support.reason);
      onProgress('Loading WebLLM library…');
      const lib = await loadModule();
      if (!lib || !lib.prebuiltAppConfig || !Array.isArray(lib.prebuiltAppConfig.model_list) ||
          !lib.prebuiltAppConfig.model_list.some(item => item.model_id === modelId) ||
          typeof lib.CreateMLCEngine !== 'function') {
        throw new Error('The selected model is not supported by the loaded WebLLM library.');
      }
      const created = await lib.CreateMLCEngine(modelId, {
        initProgressCallback: report => {
          if (typeof report?.text === 'string') onProgress(report.text.slice(0, 180));
        },
      });
      if (!created?.chat?.completions?.create) throw new Error('WebLLM did not initialize an inference engine.');
      engine = created;
      onProgress('On-device inference ready.');
      return { ready: true, model: modelId };
    })();
    try { return await initialization; }
    finally { initialization = null; }
  }

  async function respond(prompt, { context = [] } = {}) {
    if (!ready()) throw new Error('Enable the on-device model before sending a message.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1200) {
      throw new Error('Enter a message between 1 and 1,200 characters.');
    }
    // Cap context size to prevent untrusted saved text exhausting model memory.
    const prior = [];
    let characters = 0;
    if (Array.isArray(context)) {
      for (const item of context.slice(-12).reverse()) {
        if (!item || !['user', 'assistant'].includes(item.role) ||
            typeof item.content !== 'string' || !item.content.trim()) continue;
        const content = item.content.slice(0, 900);
        if (characters + content.length > 2200) break;
        prior.unshift({ role: item.role, content });
        characters += content.length;
      }
    }
    const task = requests.then(async () => {
      const answer = await engine.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...prior,
          { role: 'user', content: prompt.trim() },
        ],
        stream: false, max_tokens: 256, temperature: 0.2,
      });
      const content = answer?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim() || content.length > 12000) {
        throw new Error('On-device model returned no usable answer.');
      }
      return {
        text: content.trim(),
        model: modelId,
        kind: 'browser-inference',
        persisted: false,
        toolsExecuted: false,
        independentlyVerified: false,
      };
    });
    requests = task.then(() => undefined, () => undefined);
    return task;
  }
  return { capability, enable, respond, ready };
}
