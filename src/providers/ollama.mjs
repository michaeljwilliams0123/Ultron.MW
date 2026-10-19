// Opt-in local inference adapter. No credentials, remote hosts, or paid APIs.
const ORIGIN = 'http://127.0.0.1:11434';
const MODEL_NAME = /^[a-zA-Z0-9._:/-]{1,120}$/;

export function createLocalOllama({
  enabled = process.env.ULTRON_ENABLE_LOCAL_MODEL === '1',
  requestedModel = process.env.ULTRON_OLLAMA_MODEL || '',
  fetchImpl = fetch,
  maxWaitMs = 90000,
} = {}) {
  async function listModels() {
    if (!enabled) return [];
    const response = await fetchImpl(ORIGIN + '/api/tags', {
      signal: AbortSignal.timeout(1200),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Local Ollama model inventory unavailable');
    const data = await response.json();
    if (!Array.isArray(data.models)) throw new Error('Invalid local model inventory');
    return data.models
      .filter(model => MODEL_NAME.test(model?.name || ''))
      .map(model => ({ name: model.name, size: Number.isFinite(model.size) ? model.size : Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
  }
  async function status() {
    if (!enabled) return { ready: false, reason: 'Local inference not enabled', provider: 'ollama' };
    try {
      const installed = await listModels();
      const chosen = requestedModel ? installed.find(model => model.name === requestedModel) : installed[0];
      return chosen ? { ready: true, provider: 'ollama', model: chosen.name, installedCount: installed.length }
        : { ready: false, provider: 'ollama', reason: requestedModel ? 'Requested model not installed' : 'No local models installed' };
    } catch {
      return { ready: false, provider: 'ollama', reason: 'Local Ollama service unavailable' };
    }
  }
  async function respond(messages) {
    const live = await status();
    if (!live.ready) throw Object.assign(new Error(live.reason), { statusCode: 503 });
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), maxWaitMs);
    try {
      const response = await fetchImpl(ORIGIN + '/api/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          model: live.model, stream: false, format: 'json',
          messages, options: { temperature: 0, num_predict: 400 },
        }),
      });
      if (!response.ok) throw Object.assign(new Error('Local model request failed'), { statusCode: 502 });
      const data = await response.json();
      const content = data?.message?.content;
      if (typeof content !== 'string' || content.length > 16000) {
        throw Object.assign(new Error('Invalid local model response'), { statusCode: 502 });
      }
      try { return { model: live.model, decision: JSON.parse(content) }; }
      catch { throw Object.assign(new Error('Local model returned invalid structured output'), { statusCode: 502 }); }
    } finally { clearTimeout(abort); }
  }
  return { status, respond };
}
