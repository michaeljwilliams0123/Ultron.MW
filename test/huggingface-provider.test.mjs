import { createHuggingFace } from '../src/providers/huggingface.mjs';
import assert from 'node:assert/strict';

const disabled = createHuggingFace({ enabled: false });
const status = await disabled.status();
assert.equal(status.ready, false);
assert.equal(status.provider, 'huggingface');
assert.match(status.reason, /not enabled/i);

try {
  await disabled.respond([{ role: 'user', content: 'hi' }]);
  assert.fail('should throw');
} catch (e) {
  assert.ok(e);
}

console.log('huggingface-provider: ok');
