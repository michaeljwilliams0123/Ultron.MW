import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../.github/workflows/',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
const router=()=>read('owner-comment-router.yml');
// 26 -> 8 consolidation: cloud-objective.yml's job is inlined in the router as
// `cloud`, and pr-brain.yml's converse job is inlined as pr-conversation.
const sources=['council-debate.yml','cloud-pr.yml'];
const routerJob=(name,next)=>router().split('  '+name+':')[1].split(next?'\n  '+next+':':'\u0000')[0];

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
 assert.match(yml,/startsWith\(github\.event\.comment\.body, '\/council'\)/);
 assert.match(yml,/issue-implementation:/);
 assert.match(yml,/github\.event\.issue\.pull_request == null/);
 assert.match(yml,/startsWith\(github\.event\.comment\.body, '@ultron implement '\)/);
 assert.ok(yml.includes('uses: ./.github/workflows/cloud-pr.yml'));
 assert.match(yml,/secrets: inherit/g);
});

test('existing issue, PR, manual and review-comment entrypoints remain intact',()=>{
 assert.match(router(),/^  issues:\n    types: \[opened\]/m);
 assert.match(router(),/^  workflow_dispatch:\n    inputs:\n      objective:/m);
 assert.match(routerJob('cloud','pr-conversation'),/github\.event\.issue\.title == '\[Ultron Cloud\] Objective'/);
 assert.match(routerJob('cloud','pr-conversation'),/run: node src\/cloud-entry\.mjs/);
 assert.match(router(),/^  pull_request_review_comment:/m);
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
 // Only the inlined PR conversation job (formerly pr-brain.yml, which received
 // `secrets: inherit`) may reference the optional provider key.
 for(const [job,next] of [['cloud','pr-conversation'],['issue-implementation','council-command'],
  ['council-command','codex-trigger-audit'],['codex-trigger-audit','public-chat'],['public-chat',null]])
  assert.doesNotMatch(routerJob(job,next),/OPENAI_API_KEY|PRIVATE_KEY|MAHORAGA_PAT/,job);
 assert.doesNotMatch(yml,/PRIVATE_KEY|MAHORAGA_PAT/);
 assert.match(routerJob('pr-conversation','issue-implementation'),/OPENAI_API_KEY: \$\{\{ secrets\.ULTRON_OPENAI_API_KEY \}\}/);
 // Review comments reach only the PR conversation job.
 assert.match(routerJob('cloud','pr-conversation'),/^      \(github\.event_name == 'issues' \|\| github\.event_name == 'issue_comment' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.objective != ''\)\) &&$/m);
 for(const [job,next] of [['issue-implementation','council-command'],
  ['council-command','codex-trigger-audit'],['codex-trigger-audit','public-chat'],['public-chat',null]])
  assert.match(routerJob(job,next),/\(github\.event_name == 'issue_comment'\) &&/,job);
});

test('owner issue implementation callback has narrowly scoped OIDC permissions and receipt runner',()=>{
 const caller=router();
 const reusable=read('cloud-pr.yml');
 const issueJob=caller.split('  issue-implementation:')[1].split('\n  council-command:')[0];
 assert.match(issueJob,/id-token: write/);
 assert.doesNotMatch(issueJob,/secrets:\s*inherit/);
 // GITHUB_TOKEN is reserved: declaring or passing it makes the workflow file invalid.
 assert.doesNotMatch(issueJob,/secrets:/);
 assert.doesNotMatch(reusable,/workflow_call:\s*\n\s+secrets:/);
 assert.match(reusable,/id-token: write/);
 assert.match(reusable,/if: github\.event_name == 'issue_comment'/);
 assert.match(reusable,/run: node src\/council-room-execution\.mjs/);
 assert.match(reusable,/if: github\.event_name == 'issues'/);
});

test('council command grants the OIDC permission required by its reusable workflow',()=>{
 const caller=router();
 const reusable=read('council-debate.yml');
 const councilJob=caller.split('  council-command:')[1];
 assert.match(reusable,/id-token: write/);
 assert.match(councilJob,/id-token: write/);
});
