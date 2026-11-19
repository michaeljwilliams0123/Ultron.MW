import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {providerManifestReadiness} from '../cloud/hatchable/lib/provider-manifest-readiness.js';

test('connectors.js has no UTF-8 mojibake characters', () => {
  const src = fs.readFileSync(new URL('../cloud/hatchable/public/connectors.js', import.meta.url), 'utf8');
  assert.equal(src.includes('\uFFFD'), false);
  assert.equal(src.includes('A\uFFFD'), false);
});

test('providerManifestReadiness reflects config-driven disable and rollback without granting authority', () => {
  const bundle = providerManifestReadiness({
    gitlabRead: { state: 'authenticated-read', httpStatus: 200 },
    adapterConfigRaw: JSON.stringify({
      gitlab: { enabled: false, version: 'v1.2.0' },
      research: { enabled: true, version: 'v1.1.0', rollbackTo: 'v1.0.0' },
    }),
  });
  const byId = new Map(bundle.manifests.map(m => [m.id, m]));
  assert.equal(byId.get('gitlab').state, 'blocked');
  assert.equal(byId.get('gitlab').lifecycleEvidence.disable, 'disabled-by-config');
  assert.equal(byId.get('research').lifecycleEvidence.rollback, 'rolled-back:v1.0.0');
  assert.equal(bundle.executionAuthorized, false);
  assert.equal(bundle.paidCeilingCents, 0);
});
