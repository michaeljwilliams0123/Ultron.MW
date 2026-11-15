import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generateAppJwt, readConfiguration } from './verify-secondary-admin.mjs';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
assert.throws(() => readConfiguration({}), /Missing or invalid/);
assert.throws(() => readConfiguration({ SECONDARY_ADMIN_APP_ID: 'nope', SECONDARY_ADMIN_INSTALLATION_ID: '1', ULTRON_SECONDARY_ADMIN_PRIVATE_KEY: pem }), /Missing or invalid/);
const [header, payload, signature] = generateAppJwt('5722581', pem, 1_700_000_000).split('.');
assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iat: 1_699_999_940, exp: 1_700_000_540, iss: '5722581' });
assert.ok(signature.length > 0);
console.log('verify-secondary-admin unit tests passed');
