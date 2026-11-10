import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyCouncilFleet} from '../src/security/council-fleet-verification.mjs';

const repo={id:1424939667,full_name:'Ultron-MW/Ultron.MW'};
const now=()=>Date.parse('2026-11-10T07:00:00.000Z');
const env={GITHUB_APP_ID:'5633654',GITHUB_INSTALLATION_ID:'777321',
 GITHUB_PRIVATE_KEY:'-----BEGIN TEST KEY-----\\nnot-real\\n-----END TEST KEY-----'};
const mintScopedToken=async request=>{
 assert.deepEqual(request,{operation:'identity.read',repositoryId:repo.id,permissions:{metadata:'read'}});
 return {token:'TEST-TOKEN-NEVER-LOG',operation:'identity.read',
  installationId:777321,repositoryId:repo.id,permissions:{metadata:'read'},
  expiresAt:'2026-11-10T07:15:00.000Z'};
};

test('Council identity proof recognizes transferred canonical repository but no false 7/7',async()=>{
 const result=await verifyCouncilFleet({env,now,mintScopedToken,
  request:async()=>({ok:true,status:200,json:async()=>({total_count:1,repositories:[repo]})})});
 assert.equal(result.status,'verified');
 assert.equal(result.repository,repo.full_name);
 assert.equal(result.verifiedPrincipalCount,1);
 assert.equal(result.verifiedIndependentRoleCount,0);
 assert.equal(JSON.stringify(result).includes('TEST-TOKEN-NEVER-LOG'),false);
});

test('read-only workflow discovers installed Coordinator from existing protected client ID and key',async()=>{
 const yaml=await readFile(new URL('../.github/workflows/council-principal-proof.yml',import.meta.url),'utf8');
 assert.match(yaml,/workflow_dispatch:/);
 assert.match(yaml,/github\.repository == 'Ultron-MW\/Ultron\.MW'/);
 assert.match(yaml,/github\.actor == 'michaeljwilliams0123'/);
 assert.match(yaml,/contents: read/);
 assert.match(yaml,/actions\/create-github-app-token@[a-f0-9]{40}/);
 assert.match(yaml,/client-id: \$\{\{ vars\.ULTRON_BUILDER_CLIENT_ID \}\}/);
 assert.match(yaml,/private-key: \$\{\{ secrets\.ULTRON_BUILDER_PRIVATE_KEY \}\}/);
 assert.match(yaml,/permission-metadata: read/);
 assert.match(yaml,/steps\.coordinator\.outputs\.installation-id/);
 assert.match(yaml,/steps\.coordinator\.outputs\.app-slug/);
 assert.match(yaml,/ACTUAL_APP_SLUG: \$\{\{ steps\.coordinator\.outputs\.app-slug \}\}/);
 assert.match(yaml,/ultron-coordinator/);
 assert.match(yaml,/node scripts\/verify-council-fleet\.mjs/);
 assert.doesNotMatch(yaml,/vars\.ULTRON_GITHUB_INSTALLATION_ID|secrets\.ULTRON_GITHUB_APP_PRIVATE_KEY/);
 assert.doesNotMatch(yaml,/pull_request_target:|id-token: write|contents: write|actions: write|skip-token-revoke: true/);
});
