import { startLocalServer } from './local-server.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isAlwaysOnEnabled } from './always-on.mjs';

export { startLocalServer };

const sourcePath = fileURLToPath(import.meta.url);

if (process.argv[1] && resolve(process.argv[1]) === sourcePath) {
  startLocalServer().then(app => {
    console.log('Ultron local UI: http://127.0.0.1:' + app.port);
    console.log('Local owner pairing key (changes on restart): ' + app.ownerKey);
    if (isAlwaysOnEnabled()) console.log('Always-on standby: waiting-for-owner');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
