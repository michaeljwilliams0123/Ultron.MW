import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const page=await readFile(new URL('../cloud/hatchable/public/index.html',import.meta.url),'utf8');
const client=await readFile(new URL('../cloud/hatchable/public/cloud-gitlab.js',import.meta.url),'utf8');
const server=await readFile(new URL('../cloud/hatchable/api/brain/gitlab-branch.js',import.meta.url),'utf8');

test('cloud owner interface is reachable inside existing Hatchable Mission Control',()=>{
 assert.match(page,/id="cloud-gitlab-write"/);
 assert.match(page,/cloud-gitlab\.js" defer/);
 for(const id of ['cloud-gitlab-prepare','cloud-gitlab-copy','cloud-gitlab-grant',
 'cloud-gitlab-envelope','cloud-gitlab-submit','cloud-gitlab-reconcile',
 'cloud-gitlab-status'])
  assert.match(page,new RegExp('id="'+id+'"'));
});

test('owner UI uses the cloud API, not local Codex MCP or direct GitLab provider API',()=>{
 assert.match(client,/\/api\/brain\/gitlab-branch/);
 assert.match(client,/credentials:'same-origin'/);
 assert.match(client,/mode:'prepare'/);
 assert.match(client,/mode:'submit'/);
 assert.match(client,/mode:'reconcile'/);
 assert.match(client,/submitted=true;grantId=id;/);
 assert.match(client,/navigator\.clipboard\.writeText/);
 assert.doesNotMatch(client,/localStorage|sessionStorage|createPrivateKey|gitlab\.com\/api\/v4|\/mcp\/tools\/call/);
});

test('cloud owner route runs only the existing bounded, signed write engine',()=>{
 assert.match(server,/access='admin'/);
 assert.match(server,/req\.member\?\.handle!==OWNER/);
 assert.match(server,/origin!==ORIGIN/);
 assert.match(server,/gitlabBranchWrite\(\{\.\.\.input,db,config,api\}\)/);
 assert.doesNotMatch(server,/api\.call\(|INSERT INTO|crypto\.subtle\.sign|privateKey/);
 assert.match(server,/provider-outcome-unresolved/);
});
