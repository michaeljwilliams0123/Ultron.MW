import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../.github/workflows/',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
const router=()=>read('owner-comment-router.yml');
const sources=['cloud-objective.yml','pr-brain.yml','council-debate.yml'];

test('one native Actions workflow receives issue comments, replacing three skipped runs',()=>{
 const files=[...sources,'owner-comment-router.yml'];
 const receiving=files.filter(f=>/^  issue_comment:\s*$/m.test(read(f)));
 assert.deepEqual(receiving,['owner-comment-router.yml']);
 for(const file of sources)assert.match(read(file),/^  workflow_call:\s*$/m,file);
});

test('owner commands retain exactly the original three independently scoped capabilities',()=>{
 const yml=router();
 for(const file of sources)assert.ok(yml.includes('uses: ./.github/workflows/'+file),file);
 assert.match(yml,/github\.repository == 'michaeljwilliams0123\/Ultron\.MW'/);
 assert.match(yml,/github\.event\.comment\.user\.login == 'michaeljwilliams0123'/);
 assert.match(yml,/startsWith\(github\.event\.comment\.body, 'ULTRON_FEEDBACK_V1'\)/);
 assert.match(yml,/startsWith\(github\.event\.issue\.body, 'ULTRON_CLOUD_V1'\)/);
 assert.match(yml,/github\.event\.issue\.pull_request != null/);
 assert.match(yml,/!startsWith\(github\.event\.comment\.body, '@coderabbitai'\)/);
 assert.match(yml,/contains\(github\.event\.comment\.body, '\/council'\)/);
 assert.match(yml,/secrets: inherit/g);
});

test('existing issue, PR, manual and review-comment entrypoints remain intact',()=>{
 assert.match(read('cloud-objective.yml'),/^  issues:/m);
 assert.match(read('cloud-objective.yml'),/^  workflow_dispatch:/m);
 assert.match(read('pr-brain.yml'),/^  pull_request_review_comment:/m);
 assert.match(read('council-debate.yml'),/^  issues:/m);
 assert.match(read('council-debate.yml'),/^  pull_request:/m);
 assert.match(read('council-debate.yml'),/^  workflow_dispatch:/m);
});

test('router retains scope-limited permissions for each job, no new timers',()=>{
 const yml=router();
 assert.doesNotMatch(yml,/\bschedule:\b/);
 assert.match(yml,/\bcontents: read/);
 assert.match(yml,/\bissues: write/);
 assert.match(yml,/\bpull-requests: write/);
 assert.match(yml,/\bactions: write/);
 assert.doesNotMatch(yml,/OPENAI_API_KEY|PRIVATE_KEY|MAHORAGA_PAT/);
});
