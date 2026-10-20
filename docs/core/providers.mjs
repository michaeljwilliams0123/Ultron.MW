/**
 * Unified capability-first selector. A provider is never treated as connected
 * because code exists; only live readiness data enables that path.
 */
export function selectExecution({
  task = 'reasoning',
  host = 'browser',
  localModelReady = false,
  browserModelReady = false,
  hfModelReady = false,
  deterministicToolReady = false,
} = {}) {
  if (!['reasoning', 'read-only'].includes(task) ||
      !['browser', 'local'].includes(host)) throw new Error('Invalid execution request');
  if (task === 'read-only') {
    return deterministicToolReady && host === 'local'
      ? { provider: 'deterministic', mode: 'executable', reason: 'Verified local read-only tool' }
      : { provider: null, mode: 'plan-only', reason: 'No authenticated local execution tool is connected' };
  }
  if (host === 'local' && localModelReady)
    return { provider: 'ollama', mode: 'inference', reason: 'Installed local model confirmed ready' };
  if (host === 'local' && hfModelReady)
    return { provider: 'huggingface', mode: 'inference', reason: 'Hugging Face local model confirmed ready' };
  if (host === 'browser' && browserModelReady)
    return { provider: 'webgpu', mode: 'inference', reason: 'Explicitly activated on-device WebGPU model' };
  return { provider: null, mode: 'draft', reason: 'No model is connected; objective can be drafted' };
}
