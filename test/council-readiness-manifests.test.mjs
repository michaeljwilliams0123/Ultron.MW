import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessCouncilWiring, assessManifestStates, COUNCIL_MANIFESTS, COUNCIL_TABLES } from '../cloud/hatchable/lib/council-wiring.js';

test('assessCouncilWiring reports all 8 manifests honestly with no presumed connections', () => {
  const result = assessCouncilWiring({ tables: [...COUNCIL_TABLES] });
  assert.equal(result.manifestCount, 8);
  assert.equal(result.manifests.length, 8);
  assert.deepEqual(
    result.manifests.map(m => m.id),
    ['github', 'mahoraga', 'desktop-commander', 'descope', 'hugging-face', 'browser-use', 'compound-engineering', 'caveman']
  );
  for (const m of result.manifests) {
    assert.equal(m.state, 'blocked');
  }
  assert.equal(result.paidExternalSpendCeilingUSD, 0);
  assert.equal(result.readyForProduction, false);
});

test('assessManifestStates accepts observed connected/ready states for connectors and blocks skills', () => {
  const states = assessManifestStates([
    { id: 'github', state: 'connected', reason: 'oauth-verified' },
    { id: 'desktop-commander', state: 'ready', reason: 'device-online' },
  ]);
  const byId = new Map(states.map(s => [s.id, s]));
  assert.equal(byId.get('github').state, 'connected');
  assert.equal(byId.get('desktop-commander').state, 'ready');
  assert.equal(byId.get('mahoraga').state, 'blocked');
  assert.equal(byId.get('compound-engineering').state, 'blocked');
  assert.equal(byId.get('caveman').state, 'blocked');
  assert.throws(() => assessManifestStates([{ id: 'caveman', state: 'connected' }]), /council-wiring-manifest-invalid/);
  assert.equal(COUNCIL_MANIFESTS.length, 8);
});

test('workspace-shell.css prevents short-panel (<=650px) sidebar footer overlap', () => {
  const css = fs.readFileSync(new URL('../cloud/hatchable/public/workspace-shell.css', import.meta.url), 'utf8');
  assert.match(css, /\.ultron-ui \.u-sidebar-foot\{flex-shrink:0\}/);
  assert.match(css, /@media\(max-height:650px\)\{[\s\S]*\.u-conversations\{flex:0 0 auto;min-height:0;overflow:visible\}/);
  assert.match(css, /@media\(max-height:650px\)\{[\s\S]*\.u-chat-list\{flex:0 0 auto;min-height:0;max-height:200px\}/);
});
