import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCouncilAssessmentReceipts } from '../cloud/hatchable/lib/council-evidence.js';

const SHA = 'a'.repeat(40);

test('council accepts GitHub RFC3339 run timestamps without milliseconds', () => {
  const receipts = buildCouncilAssessmentReceipts({
    objectiveId: 'github-ci-rfc3339',
    sourceSha: SHA,
    assessedAt: '2026-10-25T23:16:20.000Z',
    observations: [{
      taskId: 1,
      receiptId: 2,
      objective: 'repo.ci',
      observedAt: '2026-10-25T23:16:19.000Z',
      result: {
        source_sha: SHA,
        complete: true,
        runs: [{
          id: 40243917833,
          name: 'Ultron core verification',
          event: 'push',
          status: 'completed',
          conclusion: 'success',
          head_sha: SHA,
          created_at: '2026-10-25T23:15:45Z',
          jobs_complete: true,
          required_job: {
            name: 'test',
            status: 'completed',
            conclusion: 'success'
          }
        }]
      }
    }]
  });

  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].role, 'sentinel');
  assert.equal(receipts[0].assessment, 'exact-head-ci-success');
  assert.deepEqual(receipts[0].dissent, []);
});
