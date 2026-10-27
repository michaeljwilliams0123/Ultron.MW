import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildRouteReferenceInventory } from '../src/route-reference-audit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const paths = git(['ls-files', '-z']).split('\0').filter(Boolean).sort();
const files = {}, omitted = [];
for (const path of paths) {
  if (!/\.(mjs|js|json|md|ya?ml|sh|html|css|sql|txt)$/.test(path)) {
    omitted.push({ path, reason: 'non-text-source-extension' }); continue;
  }
  const fullPath = resolve(root, path), info = await lstat(fullPath);
  if (!info.isFile() || info.size > 512 * 1024) {
    omitted.push({ path, reason: 'symlink-or-nonregular-or-oversize' }); continue;
  }
  files[path] = await readFile(fullPath, 'utf8');
}
const inventory = buildRouteReferenceInventory(files);
process.stdout.write(JSON.stringify({ ...inventory,
  source: { revision: git(['rev-parse', 'HEAD']).trim(),
    workingTreeChanged: Boolean(git(['status', '--porcelain']).trim()), trackedPaths: paths.length },
  omitted,
}, null, 2) + '\n');
if (inventory.missingRetainedRoutes.length || inventory.unresolvedModuleReferences.length)
  process.exitCode = 1;
