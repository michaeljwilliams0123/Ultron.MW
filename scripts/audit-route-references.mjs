import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { buildRouteReferenceInventory } from '../src/route-reference-audit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const realRoot = await realpath(root);
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const paths = git(['ls-files', '-z']).split('\0').filter(Boolean).sort();
const files = {}, omitted = [];
for (const path of paths) {
  if (!/\.(mjs|js|json|md|ya?ml|sh|html|css|sql|txt)$/.test(path)) {
    omitted.push({ path, reason: 'non-text-source-extension' }); continue;
  }
  const fullPath = resolve(root, path);
  let info, parentSymlink = false;
  try {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      if ((await lstat(resolve(root, ...parts.slice(0, i)))).isSymbolicLink()) {
        parentSymlink = true; break;
      }
    }
    if (parentSymlink) {
      omitted.push({ path, reason: 'symlinked-parent' }); continue;
    }
    info = await lstat(fullPath);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) {
      omitted.push({ path, reason: 'missing-working-tree-file' }); continue;
    }
    throw error;
  }
  if (!info.isFile() || info.size > 512 * 1024) {
    omitted.push({ path, reason: 'symlink-or-nonregular-or-oversize' }); continue;
  }
  const resolved = relative(realRoot, await realpath(fullPath));
  if (isAbsolute(resolved) || resolved === '..' || resolved.startsWith('..' + sep)) {
    omitted.push({ path, reason: 'outside-checkout' }); continue;
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
