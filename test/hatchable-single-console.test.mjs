import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const source=(p)=>readFileSync(resolve(process.cwd(),p),'utf8');
const live='cloud/hatchable/public';
const workspace=live+'/workspace.html';

test('UI-CUTOVER-01: one Hatchable origin navigates between existing workspace and cloud controls',()=>{
 const root=source(live+'/index.html');
 const legacy=source(workspace);
 assert.match(root, /href=["']\/?workspace\.html["']/);
 assert.match(legacy, /href=["']\/?["'][^>]*>Cloud controls<\/a>/i);
 assert.match(legacy, /id="pane-brain"/);
 assert.match(legacy, /id="pane-learning"/);
 assert.match(legacy, /id="pane-systems"/);
 assert.match(legacy, /src="\.\/app\.js"/);
 assert.doesNotMatch(legacy, /<iframe\b/i);
});

test('UI-CUTOVER-02: migrated browser code dependencies resolve locally without GitHub Pages',()=>{
 const required=['app.js','browser-vault.mjs','browser-brain.mjs','core/cycle.mjs',
  'core/capabilities.mjs','core/cloud-status.mjs','core/cloud-submit.mjs',
  'core/cloud-pr-submit.mjs','core/codex-authors.mjs'];
 for(const path of required)assert.ok(existsSync(resolve(process.cwd(),live,path)),path);
 const app=source(live+'/app.js');
 for(const dependency of required.filter(x=>x!=='app.js'))
   assert.ok(app.includes(dependency)||dependency==='core/capabilities.mjs',
    'missing dependency '+dependency);
});

test('UI-CUTOVER-03: owner-only operations remain protected by backend access gates',()=>{
 assert.match(source('cloud/hatchable/api/brain/autonomy.js'),/export const access='admin'/);
 assert.match(source('cloud/hatchable/api/brain/control.js'),/export const access='admin'/);
 const cloud=source(live+'/index.html');
 assert.match(cloud,/\/api\/brain\/autonomy/);
 assert.doesNotMatch(cloud,/<iframe\b/i);
});

test('UI-CUTOVER-04: mirrored workspace JavaScript is byte-identical to the maintained Pages source',()=>{
 const paths=['app.js','browser-vault.mjs','browser-brain.mjs',
  'core/cycle.mjs','core/capabilities.mjs','core/cloud-status.mjs',
  'core/cloud-submit.mjs','core/cloud-pr-submit.mjs','core/codex-authors.mjs'];
 for(const path of paths)
  assert.equal(source(live+'/'+path),source('docs/'+path),
   'Pages source drift: '+path);
});

test('UI-CUTOVER-05: cloud objective admission is key-stable and read-only',()=>{
 const root=source(live+'/index.html');
 assert.match(root,/id="inspection-form"/);
 assert.match(root,/id="task-list"/);
 assert.match(root,/\/api\/brain\/tasks/);
 assert.match(root,/owner-ui-inspect-/);
 assert.match(root,/\['repo\.inspect','repo\.prs','repo\.ci','site\.render','council\.review'\]/);
 assert.match(root,/credentials:'same-origin'/);
 assert.match(source('cloud/hatchable/api/brain/tasks.js'),/export const access='admin'/);
});
