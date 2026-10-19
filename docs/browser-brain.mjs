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
  'Your current browser model cannot directly use GitHub, files, remote services or tools.',
  'The Ultron web interface separately offers owner-confirmed GitHub-hosted execution and Create PR to main. Explain those buttons when asked about tools, but never claim this browser model executed them.',
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
    // Accept only bounded prior user/assistant text. Stored conversations
    // are contextual data, never trusted system/tool messages.
    const prior = Array.isArray(context) ? context.slice(-6)
      .filter(item => item && ['user', 'assistant'].includes(item.role) &&
        typeof item.content === 'string' && item.content.trim())
      .map(item => ({ role: item.role, content: item.content.slice(0, 1000) })) : [];
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
