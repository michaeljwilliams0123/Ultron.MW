/**
 * Evidence-gated, provider-agnostic harness learning.
 * No weights are trained by this module.
 */
export class LearningLoop {
  constructor(snapshot = {}) {
    this.accepted = snapshot.accepted || 'seed-v1';
    this.history = Array.isArray(snapshot.history) ? [...snapshot.history] : [];
    this.observations = new Map((snapshot.observations || []).map(x => [x.id, x]));
    this.candidates = new Map((snapshot.candidates || []).map(x => [x.id, x]));
  }
  observe(record) {
    if (!record || typeof record.id !== 'string' || !record.id || !record.taskId || !record.evidence || typeof record.score !== 'number' || !Number.isFinite(record.score) || record.score < 0 || record.score > 1) {
      throw new Error('A valid ID, task ID, evidence and 0–1 score are required');
    }
    if (this.observations.has(record.id)) return { duplicate: true, record: this.observations.get(record.id) };
    const item = Object.freeze({ id: record.id, taskId: String(record.taskId), score: record.score, evidence: String(record.evidence), source: String(record.source || 'unknown'), at: new Date().toISOString() });
    this.observations.set(item.id, item);
    return { duplicate: false, record: item };
  }
  propose({ id, description, artifactHash }) {
    if (!id || !description || !artifactHash || this.candidates.has(id)) throw new Error('Candidate needs a unique ID, description and artifact hash');
    const item = { id: String(id), description: String(description), artifactHash: String(artifactHash), parent: this.accepted, status: 'proposed', evaluation: null };
    this.candidates.set(item.id, item);
    return { ...item };
  }
  evaluate(id, evidence) {
    const candidate = this.candidates.get(id);
    if (!candidate || candidate.status !== 'proposed') throw new Error('Candidate must exist and be proposed');
    const { sampleSize, baselineScore, candidateScore, criticalRegressions, evaluatorId } = evidence || {};
    const valid = Number.isInteger(sampleSize) && sampleSize >= 10 &&
      [baselineScore, candidateScore].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) &&
      Number.isInteger(criticalRegressions) && criticalRegressions >= 0 &&
      typeof evaluatorId === 'string' && evaluatorId.length > 0;
    if (!valid) throw new Error('Independent evaluator, >=10 samples and valid scores required');
    const passed = criticalRegressions === 0 && candidateScore - baselineScore >= 0.02;
    candidate.evaluation = { sampleSize, baselineScore, candidateScore, criticalRegressions, evaluatorId, passed };
    candidate.status = passed ? 'validated' : 'rejected';
    return { id, ...candidate.evaluation };
  }
  promote(id) {
    const item = this.candidates.get(id);
    if (!item || item.status !== 'validated' || item.parent !== this.accepted) throw new Error('Candidate has not passed evaluation on current accepted base');
    const previous = this.accepted;
    this.accepted = item.id;
    item.status = 'accepted';
    this.history.push({ action: 'promote', from: previous, to: item.id, at: new Date().toISOString(), evaluation: { ...item.evaluation } });
    return this.accepted;
  }
  rollback(reason) {
    if (!reason) throw new Error('Rollback requires a reason');
    const latest = [...this.history].reverse().find(x => x.action === 'promote' && x.to === this.accepted);
    if (!latest) throw new Error('No accepted candidate to roll back');
    const previous = this.accepted;
    this.accepted = latest.from;
    this.history.push({ action: 'rollback', from: previous, to: latest.from, reason: String(reason), at: new Date().toISOString() });
    return this.accepted;
  }
  snapshot() {
    return { accepted: this.accepted, history: [...this.history], observations: [...this.observations.values()], candidates: [...this.candidates.values()] };
  }
}
