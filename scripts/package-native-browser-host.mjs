import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { packageNativeBrowserHost, enrollNativeDevice, revokeNativeDevice } from '../src/computer/native-browser-host-package.mjs';

const [, , mode, targetDir, arg3, arg4] = process.argv;
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

if (mode === 'package' && targetDir && arg3) {
  const pkg = await packageNativeBrowserHost({
    targetDir,
    repoRoot,
    extensionOrigin: arg3,
  });
  console.log(JSON.stringify({
    packaged: pkg.targetDir,
    manifestPath: pkg.manifestPath,
    cmdPath: pkg.cmdPath,
    privateKeyAcl: pkg.privateKeyAcl,
    pairingInfo: pkg.pairingInfo,
    registryPlan: pkg.registryPlan,
    manualRegistrationNote: 'Run reg add manually only after reviewing manifestPath and extensionOrigin.',
  }, null, 2));
} else if (mode === 'enroll' && targetDir && arg3) {
  const enrollment = await readFile(arg3, 'utf8');
  const record = await enrollNativeDevice({ targetDir, enrollment });
  console.log(JSON.stringify({ enrolled: record.deviceId, hostId: record.hostId, extensionOrigin: record.extensionOrigin }, null, 2));
} else if (mode === 'revoke' && targetDir && arg3) {
  const record = await revokeNativeDevice({ targetDir, deviceId: arg3, reason: arg4 || 'owner-revoked' });
  console.log(JSON.stringify({ revoked: record.deviceId, revokedAt: record.revokedAt, reason: record.revokedReason }, null, 2));
} else {
  throw Error('Usage: node scripts/package-native-browser-host.mjs <package <new-abs-dir> <extension-origin> | enroll <pkg-dir> <enrollment-json-path> | revoke <pkg-dir> <device-id> [reason]>');
}
