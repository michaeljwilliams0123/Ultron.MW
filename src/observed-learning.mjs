/**
 * Evidence-based action feedback: labels come only from verified real operations
 * plus owner feedback, never from a model's self-reported success. A candidate
 * is synthesized from previously observed task words; a held-out set gates it.
 * The policy only suggests an action type, never executes or widens authority.
 */
import { createHash } from 'node:crypto';
const KINDS = ['workspace-note', 'github-draft'];
const STOP = new Set(['the','a','an','for','to','in','of','my','and','please','me','this','that','some','write']);
function tokens(text) {
  return [...new Set((text.toLowerCase().match(/[a-z]{3,}/g) || [])
    .filter(token => !STOP.has(token)))].slice(0,30);
}
export function originalSuggestion(text) {
  const t = String(text).toLowerCase();
  if (/\b(github|repo|pull request|draft pr)\b/.test(t)) return 'github-draft';
  if (/\b(local|computer|workspace|private note)\b/.test(t)) return 'workspace-note';
  return null;
}
export function trainCandidate(records) {
  const labels = records.filter(r => KINDS.includes(r.kind) &&
    r.verified === true && r.feedback === 'helpful' &&
    typeof r.objective === 'string');
  const byId = new Map(labels.map(r => [r.jobId, r]));
  const unique = [...byId.values()].sort((a,b)=>a.jobId.localeCompare(b.jobId));
  if (unique.length < 16) return {
    status: 'insufficient-evidence', count: unique.length, required: 16,
    note: 'Verified owner-rated real executions required before proposal',
  };
  const heldout = [], training = [];
  for (const [i,item] of unique.entries()) {
    if (i % 4 === 0) heldout.push(item); else training.push(item);
  }
  if (heldout.length < 4 || training.length < 12) {
    return { status:'insufficient-evidence',count:unique.length,required:16 };
  }
  const counts = Object.fromEntries(KINDS.map(kind=>[kind,{}]));
  const priors = Object.fromEntries(KINDS.map(kind=>[kind,0]));
  for (const item of training) {
    priors[item.kind] += 1;
    for (const token of tokens(item.objective))
      counts[item.kind][token] = (counts[item.kind][token] || 0) + 1;
  }
  function predict(text) {
    const words = tokens(text);
    const scores = KINDS.map(kind => ({
      kind, score: words.reduce((total,word) =>
        total + (counts[kind][word]||0) / Math.max(1,priors[kind]), 0),
    })).sort((a,b)=>b.score-a.score);
    // Abstain unless there is a clear unique, positive signal.
    return scores[0].score > 0 && scores[0].score > scores[1].score
      ? scores[0].kind : null;
  }
  let baseline = 0, challenger = 0, regressions = 0;
  for (const item of heldout) {
    const b=originalSuggestion(item.objective), c=predict(item.objective);
    if(b===item.kind)baseline++;
    if(c===item.kind)challenger++;
    if(b===item.kind && c!==item.kind)regressions++;
  }
  const baselineAccuracy = baseline/heldout.length;
  const candidateAccuracy = challenger/heldout.length;
  const passed = candidateAccuracy - baselineAccuracy >= .05 &&
    regressions === 0 && challenger > baseline;
  const model = {
    version:'owner-observations-' + createHash('sha256')
      .update(JSON.stringify(training.map(r=>[r.jobId,r.kind]))).digest('hex').slice(0,12),
    priors,counts,
  };
  return {
    status:passed?'validated':'rejected', passed, training:training.length,
    heldout:heldout.length, baselineAccuracy,candidateAccuracy,regressions,
    proposal: passed?model:null, measurement: 'Held-out owner-rated verified action type suggestions, not model weight training or action permission',
  };
}
export function suggestAction(text, model) {
  if(!model) return originalSuggestion(text);
  if (!model.priors || !model.counts) return null;
  const scores = KINDS.map(kind => ({
    kind, score: tokens(String(text)).reduce((total,word) =>
      total+(model.counts[kind]?.[word]||0)/Math.max(1,model.priors[kind]||0),0),
  })).sort((a,b)=>b.score-a.score);
  return scores[0].score > 0 && scores[0].score > scores[1].score
    ? scores[0].kind:null;
}
