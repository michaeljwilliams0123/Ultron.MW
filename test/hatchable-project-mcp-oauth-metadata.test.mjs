import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Regressions for Hatchable project-host OAuth discovery. Codex 0.154
// mistakenly falls back to the project's /authorize SPA route when the
// cross-origin protected-resource metadata challenge is not followed.
const metadataPath=new URL('../public/.well-known/oauth-protected-resource/mcp',import.meta.url);

test('project-native MCP advertises owner OAuth on Hatchable issuer, not Ultron SPA',async()=>{
 const raw=await readFile(metadataPath,'utf8');
 const meta=JSON.parse(raw);
 assert.equal(meta.resource,'https://ultron-mw-cloud.hatchable.site/mcp');
 assert.deepEqual(meta.authorization_servers,['https://hatchable.com/oauth/ultron-mw-cloud']);
 assert.deepEqual(meta.bearer_methods_supported,['header']);
 assert.ok(meta.scopes_supported.includes('project:full'));
 assert.equal(Object.hasOwn(meta,'client_secret'),false);
 assert.equal(Object.hasOwn(meta,'access_token'),false);
});
