// Opt-in local Hugging Face Transformers adapter.
// No remote inference endpoints, API keys, or paid calls by default.
// Requires ULTRON_ENABLE_HF=1 and a downloadable model id.

const MODEL_ID = /^[a-zA-Z0-9._:/-]{1,200}$/;
const REVISION = /^[a-f0-9]{40}$/;

export function createHuggingFace({
  enabled = process.env.ULTRON_ENABLE_HF === '1',
  modelId = process.env.ULTRON_HF_MODEL || 'Xenova/distilgpt2',
  revision = process.env.ULTRON_HF_REVISION || null,
  maxNewTokens = 256,
  temperature = 0,
} = {}) {
  let pipelinePromise = null;

  async function loadPipeline() {
    if (!enabled) throw new Error('Hugging Face provider not enabled');
    if (!MODEL_ID.test(modelId)) throw new Error('Invalid HF model id');
    if (!REVISION.test(revision || ''))
      throw new Error('A pinned 40-character Hugging Face revision is required');
    if (!pipelinePromise) {
      pipelinePromise = (async () => {
        const { pipeline } = await import('@huggingface/transformers');
        return pipeline('text-generation', modelId, { dtype: 'q8', revision });
      })();
    }
    return pipelinePromise;
  }

  async function status() {
    if (!enabled) {
      return { ready: false, reason: 'Hugging Face inference not enabled', provider: 'huggingface' };
    }
    if (!MODEL_ID.test(modelId)) {
      return { ready: false, provider: 'huggingface', reason: 'Invalid HF model id' };
    }
    if (!REVISION.test(revision || '')) {
      return { ready: false, provider: 'huggingface',
        reason: 'A pinned 40-character Hugging Face revision is required' };
    }
    try {
      await loadPipeline();
      return { ready: true, provider: 'huggingface', model: modelId, revision };
    } catch (err) {
      return {
        ready: false,
        provider: 'huggingface',
        reason: err?.message ? String(err.message).slice(0, 200) : 'HF model load failed',
      };
    }
  }

  async function respond(messages) {
    const live = await status();
    if (!live.ready) throw Object.assign(new Error(live.reason), { statusCode: 503 });

    const system = messages.find(m => m.role === 'system')?.content || '';
    const userParts = messages.filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role}: ${m.content}`).join('\n');
    const prompt = [system, userParts, 'assistant:'].filter(Boolean).join('\n\n');

    const generator = await loadPipeline();
    const outputs = await generator(prompt, {
      max_new_tokens: maxNewTokens,
      temperature,
      do_sample: temperature > 0,
      return_full_text: false,
    });
    const raw = Array.isArray(outputs) ? outputs[0]?.generated_text : outputs?.generated_text;
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 16000) {
      throw Object.assign(new Error('Invalid HF model response'), { statusCode: 502 });
    }

    // Prefer structured JSON when the model emits it; otherwise wrap as reply.
    let decision;
    const trimmed = raw.trim();
    try {
      const parsed = JSON.parse(trimmed);
      decision = parsed;
    } catch {
      decision = { action: 'reply', text: trimmed.slice(0, 4000) };
    }
    return { model: modelId + '@' + revision, decision };
  }

  return { status, respond };
}
