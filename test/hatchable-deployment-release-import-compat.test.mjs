import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../cloud/hatchable/lib/deployment-release-receipt.js', import.meta.url), 'utf8');

test('Hatchable deployment receipt library avoids unsupported re-export-from syntax', () => {
  assert.doesNotMatch(source, /export\\s*\\{[^}]*\\}\\s*from\\s*['\"]\\.\\/deployment-release-receipt\\/read\\.js['\"]/s);
  assert.match(source, /import\\s*\\{[^}]*\\bprepareDeploymentReleaseReceipt\\b[^}]*\\}\\s*from\\s*['\"]\\.\\/deployment-release-receipt\\/read\\.js['\"]/s);
  assert.match(source, /import\\s*\\{\\s*verifyDelegatedGrant\\s*\\}\\s*from\\s*['\"]\\.\\/security-adjudicator\\.js['\"]/);
  assert.match(source, /export\\s*\\{[^}]*\\bprepareDeploymentReleaseReceipt\\b[^}]*\\};/s);
});
