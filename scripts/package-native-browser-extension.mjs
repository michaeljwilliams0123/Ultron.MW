import {mkdir,copyFile} from 'node:fs/promises';
import {resolve,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const dest=process.argv[2];
if(process.argv.length!==3||!dest||!isAbsolute(dest))throw Error('Usage: node scripts/package-native-browser-extension.mjs <new absolute directory>');
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(dest);
for(const f of ['manifest.json','popup.html','popup.css','popup.mjs','pairing.mjs','port.mjs'])
 await copyFile(join(root,'browser-extension','ultron-native',f),join(dest,f));
await copyFile(join(root,'src','computer','native-browser-client.mjs'),join(dest,'native-browser-client.mjs'));
console.log('Packaged native read canary: '+resolve(dest));
