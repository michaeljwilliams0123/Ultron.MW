import test from 'node:test';
import assert from 'node:assert/strict';
import {
  baselineSuggestion, suggestFromExperience, verifiedExperiences,
  evaluateExperience, advanceExperience,
} from '../src/experience.mjs';

const WORDS = [
  'alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel',
  'india','juliet','kilo','lima','mango','november','oscar','papa',
  'quebec','romeo','sierra','tango','uniform','victor','whiskey','xray',
  'yankee','zulu','amber','birch','cedar','dawn','elm','fern',
];
function fixture(n = 24, { negativeVariant = 'duplicate', allPositive = false } = {}) {
  const jobs = [], receipts = [];
  for (let i = 0; i < n; i++) {
    const bad = !allPositive && i % 2 === 1;
    const word = WORDS[i % WORDS.length];
    const label = bad && (negativeVariant === 'duplicate' || i < 18) ?
      'duplicate incorrect' : bad ? 'unexpectedly disappointing' : 'operational journal';
    const id = 'verified-operation-' + word;
    const sha256 = 'a'.repeat(64);
    const receiptId = 'receipt-' + word;
    const job = {
      id, kind: 'local-note', status: 'verified', title: 'Local workspace ' + label,
      text: 'Maintain a ' + word + ' case for review and historical context',
      result: { verified: true, kind: 'local-note', sha256 },
      receiptId, rating: bad ? 'not-helpful' : 'helpful',
      latencyMs: 25 + i, ratedAt: '2026-10-19T12:00:00Z',
      verifiedAt: new Date(Date.UTC(2026, 9, 19, 12, i)).toISOString(),
    };
    jobs.push(job);
    receipts.push({
      id: receiptId, kind: 'verified-owner-action',
      command: 'local-note', operationId: id, status: 'succeeded',
      details: { verified: true, sha256 },
    });
  }
  return { jobs, receipts };
}

test('without actual verified rated experiences nothing is learned or promoted', () => {
  const report = evaluateExperience([],[]);
  assert.equal(report.status, 'insufficient-evidence');
  assert.equal(report.eligible, 0);
  assert.equal(report.adopted, false);
  assert.equal(report.candidate, null);
  const next = advanceExperience(undefined,[],[]);
  assert.equal(next.state.active, null);
  assert.equal(next.state.assessments.length, 1);
  const repeat = advanceExperience(next.state,[],[]);
  assert.equal(repeat.result.status, 'unchanged-evidence');
  assert.equal(repeat.state.assessments.length, 1);
});

test('forged receipts, wrong action IDs, pending jobs and missing ratings never train', () => {
  const { jobs, receipts } = fixture(24);
  receipts[0].operationId = 'other-job';
  receipts[1].details.sha256 = 'b'.repeat(64);
  jobs[2].status = 'running';
  jobs[3].rating = undefined;
  jobs[4].result.verified = false;
  jobs[5].latencyMs = NaN;
  assert.equal(verifiedExperiences(jobs,receipts).length,18);
  const copy = structuredClone(jobs[6]);
  copy.id = 'another-id';
  jobs.push(copy);
  // Same objective text must not count as a new independent example.
  assert.equal(verifiedExperiences(jobs,receipts).length,18);
});

test('numeric renames alone cannot artificially increase eligible evidence', () => {
  const { jobs, receipts } = fixture(24);
  for(const [i, job] of jobs.entries()) {
    job.title = 'Local note ' + i;
    job.text = 'Exact same content for numbered example ' + (i+1);
  }
  assert.equal(verifiedExperiences(jobs,receipts).length,1);
  assert.equal(evaluateExperience(jobs,receipts).status,'insufficient-evidence');
});

test('candidate learns from earlier rated outcomes and improves on truly held-out later cases', () => {
  const { jobs, receipts } = fixture();
  const result = evaluateExperience(jobs,receipts);
  assert.equal(result.eligible,24);
  assert.equal(result.training,18);
  assert.equal(result.heldout,6);
  assert.equal(result.status,'validated');
  assert.equal(result.adopted,true);
  assert.equal(result.regressions,0);
  assert.equal(result.unsafeSuggestions,0);
  assert.ok(result.candidateAccuracy > result.baselineAccuracy);
  assert.ok(result.delta >= .05);
  const adopted = advanceExperience(undefined,jobs,receipts);
  assert.equal(adopted.state.active.version,result.version);
  assert.equal(adopted.state.history[0].action,'promote');
  assert.equal(suggestFromExperience('Local workspace duplicate incorrect record', adopted.state.active), null);
  assert.equal(suggestFromExperience('Local workspace operational journal', adopted.state.active), 'local-note');
  assert.equal(suggestFromExperience('Local workspace journal', adopted.state.active,[]),null);
  assert.equal(suggestFromExperience('deploy repo', adopted.state.active,['github-draft']),null);
});

test('no negative examples means insufficient diversity, not spurious 100% learning', () => {
  const { jobs, receipts } = fixture(24,{allPositive:true});
  const r = evaluateExperience(jobs,receipts);
  assert.equal(r.status,'insufficient-diversity');
  assert.equal(r.adopted,false);
});

test('no actual improvement or new errors cause candidate rejection', () => {
  const { jobs, receipts } = fixture(24,{negativeVariant:'unexpected'});
  const report = evaluateExperience(jobs,receipts);
  assert.equal(report.status,'rejected');
  assert.equal(report.adopted,false);
  assert.equal(report.candidate,null);
});

test('adoption is idempotent for unchanged receipts and rollback leaves an audit trail', () => {
  const { jobs,receipts }=fixture();
  const first=advanceExperience(undefined,jobs,receipts);
  assert.equal(first.state.history.length,1);
  const same=advanceExperience(first.state,jobs,receipts);
  assert.equal(same.result.status,'unchanged-evidence');
  assert.equal(same.state.history.length,1);
  assert.equal(same.state.assessments.length,1);
  const rolled=advanceExperience(same.state,jobs,receipts,{rollback:true});
  assert.equal(rolled.state.active,null);
  assert.equal(rolled.state.history.at(-1).action,'rollback');
  assert.equal(rolled.result.active,'baseline');
});

test('baseline guards dangerous objectives regardless of learned policy', () => {
  assert.equal(baselineSuggestion('merge my github pull request'),null);
  assert.equal(baselineSuggestion('delete local file'),null);
  assert.equal(baselineSuggestion('write a local workspace note'),'local-note');
  assert.equal(baselineSuggestion('review github repository'),'github-draft');
});


test('an incumbent learned policy auto-rolls back when fresh held-out outcomes expose regression', () => {
  const { jobs, receipts } = fixture();
  const deliberatelyBadIncumbent = {
    version: 'known-bad-incumbent',
    positive: { 'local-note': {}, 'github-draft': {} },
    totals: { 'local-note': 0, 'github-draft': 0 },
    negative: { operational: 20, journal: 20 },
    negativeTotal: 20,
  };
  const report = evaluateExperience(jobs, receipts, deliberatelyBadIncumbent);
  assert.ok(report.incumbentRegressions > 0);
  const previous = {
    active: deliberatelyBadIncumbent, history: [], assessments: [],
    lastEvidence: null,
  };
  const result = advanceExperience(previous, jobs, receipts);
  assert.equal(result.result.status, 'rolled-back-on-regression');
  assert.equal(result.state.active, null);
  assert.equal(result.state.history.at(-1).action, 'auto-rollback');
  assert.equal(result.state.history.at(-1).reason, 'new-heldout-regression');
});
