/**
 * Versioned learning ledger. Evaluations are run against baseline and candidate.
 * This module trains no model weights. Only a trusted benchmark runner should
 * be passed into evaluate() when promoting genuine production artifacts.
 */
export class LearningLoop {
  constructor(snapshot = {}) {
    this.accepted = snapshot.accepted || 'seed-v1';
    this.history = Array.isArray(snapshot.history) ? [...snapshot.history] : [];
    this.observations = new Map((snapshot.observations || []).map(x => [x.id, x]));
    this.candidates = new Map((snapshot.candidates || []).map(x => [x.id, x]));
  }
  observe(record) {
    if (!record || typeof record.id !== 'string' || !record.id || !record.taskId ||
      typeof record.evidence !== 'string' || !record.evidence.trim() ||
      typeof record.score !== 'number' || !Number.isFinite(record.score) ||
      record.score < 0 || record.score > 1) {
      throw new Error('A valid ID, task ID, evidence and 0–1 score are required');
    }
    const existing = this.observations.get(record.id);
    if (existing) return { duplicate: true, record: existing };
    const item = Object.freeze({
      id: record.id, taskId: String(record.taskId), score: record.score,
      evidence: record.evidence, source: String(record.source || 'unknown'),
      at: new Date().toISOString(),
    });
    this.observations.set(item.id, item);
    return { duplicate: false, record: item };
  }
  propose({ id, description, artifactHash }) {
    if (typeof id !== 'string' || !id.trim() || typeof description !== 'string' ||
      !description.trim() || typeof artifactHash !== 'string' || !artifactHash.trim() ||
      this.candidates.has(id)) {
      throw new Error('Candidate needs a unique ID, description and artifact hash');
    }
    const item = { id, description, artifactHash, parent: this.accepted, status: 'proposed', evaluation: null };
    this.candidates.set(item.id, item);
    return { ...item };
  }
  async evaluate(id, { cases, run } = {}) {
    const candidate = this.candidates.get(id);
    if (!candidate || candidate.status !== 'proposed') {
      throw new Error('Candidate must exist and be proposed');
    }
    if (!Array.isArray(cases) || cases.length < 10 || cases.length > 1000 ||
      new Set(cases.map(item => item?.id)).size !== cases.length ||
      cases.some(item => !item || typeof item.id !== 'string' || !item.id.trim()) ||
      typeof run !== 'function') {
      throw new Error('A benchmark runner and 10–1000 uniquely identified cases are required');
    }
    let baselineTotal = 0, candidateTotal = 0, criticalRegressions = 0;
    for (const item of cases) {
      const baseline = await run({ testCase: item, version: candidate.parent });
      const changed = await run({ testCase: item, version: candidate.id });
      for (const result of [baseline, changed]) {
        if (!result || typeof result.score !== 'number' || !Number.isFinite(result.score) ||
          result.score < 0 || result.score > 1) {
          throw new Error('Benchmark runner returned an invalid score');
        }
      }
      baselineTotal += baseline.score;
      candidateTotal += changed.score;
      if (changed.criticalRegression === true) criticalRegressions++;
    }
    const baselineScore = baselineTotal / cases.length;
    const candidateScore = candidateTotal / cases.length;
    const passed = criticalRegressions === 0 && candidateScore - baselineScore >= 0.02;
    candidate.evaluation = { sampleSize: cases.length, baselineScore, candidateScore, criticalRegressions, passed };
    candidate.status = passed ? 'validated' : 'rejected';
    return { id, ...candidate.evaluation };
  }
  promote(id) {
    const item = this.candidates.get(id);
    if (!item || item.status !== 'validated' || item.parent !== this.accepted) {
      throw new Error('Candidate has not passed evaluation on current accepted base');
    }
    const previous = this.accepted;
    this.accepted = item.id;
    item.status = 'accepted';
    this.history.push({ action: 'promote', from: previous, to: item.id,
      at: new Date().toISOString(), evaluation: { ...item.evaluation } });
    return this.accepted;
  }
  rollback(reason) {
    if (typeof reason !== 'string' || !reason.trim()) throw new Error('Rollback requires a reason');
    const latest = [...this.history].reverse().find(x => x.action === 'promote' && x.to === this.accepted);
    if (!latest) throw new Error('No accepted candidate to roll back');
    const previous = this.accepted;
    this.accepted = latest.from;
    this.history.push({ action: 'rollback', from: previous, to: latest.from, reason, at: new Date().toISOString() });
    return this.accepted;
  }
  snapshot() {
    return { accepted: this.accepted, history: [...this.history], observations: [...this.observations.values()], candidates: [...this.candidates.values()] };
  }
}
