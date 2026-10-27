import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildRouteReferenceInventory, RETAINED_ROUTES } from '../src/route-reference-audit.mjs';

test('imports, re-exports, workflow invocations and page assets have source/line evidence', () => {
  const result = buildRouteReferenceInventory({
    'src/main.mjs': "import {run} from './worker.mjs';\nexport {run} from './worker.mjs';\nconst x=import('./worker.mjs');",
    'src/worker.mjs': 'export const run=()=>{};',
    '.github/workflows/verify.yml': 'run: node src/main.mjs',
    'docs/index.html': '<script src="app.js?v=1"></script>', 'docs/app.js': '',
  });
  const worker = result.routes.find(x => x.path === 'src/worker.mjs');
  assert.equal(worker.classification, 'referenced-source');
  assert.deepEqual(worker.referencedBy.map(x => [x.source, x.line, x.kind]), [
    ['src/main.mjs', 1, 'module-specifier'], ['src/main.mjs', 2, 'module-specifier'], ['src/main.mjs', 3, 'module-specifier'],
  ]);
  assert.equal(result.routes.find(x => x.path === 'src/main.mjs').referencedBy[0].kind, 'workflow-reference');
  assert.equal(result.routes.find(x => x.path === 'docs/app.js').referencedBy[0].kind, 'document-link');
});
test('a retained workflow remains retained without an inbound reference', () => {
  const result = buildRouteReferenceInventory(Object.fromEntries(RETAINED_ROUTES.map(path => [path, ''])));
  assert.deepEqual(result.missingRetainedRoutes, []);
  assert.ok(result.routes.every(x => x.classification === 'retained-entrypoint' && !x.deletionEligible));
});
test('no references is only a candidate; static references never attest runtime acceptance', () => {
  const result = buildRouteReferenceInventory({ 'src/unused.mjs': '', 'README.md': 'src/unused.mjs' });
  assert.equal(result.routes[0].classification, 'referenced-source');
  assert.equal(result.routes[0].runtimeEvidence, 'not-probed');
  assert.equal(result.routes[0].deletionEligible, false);
  const unknown = buildRouteReferenceInventory({ 'src/unused.mjs': '' }).routes[0];
  assert.equal(unknown.classification, 'unreferenced-candidate'); assert.equal(unknown.deletionEligible, false);
});
test('missing module targets and retained paths remain visible instead of becoming cleanup permission', () => {
  const result = buildRouteReferenceInventory({ 'src/a.mjs': "import './missing.mjs';" });
  assert.deepEqual(result.unresolvedModuleReferences, [{ source: 'src/a.mjs', line: 1, specifier: './missing.mjs' }]);
  assert.ok(result.missingRetainedRoutes.includes('.github/workflows/verify.yml'));
});
test('endpoint inventory strips credentials, path and query data and remains unprobed', () => {
  const result = buildRouteReferenceInventory({ 'src/a.mjs': 'const url="https://user:private@example.test/secret?token=sensitive#value";' });
  assert.deepEqual(result.endpointOrigins, [{ origin: 'https://example.test', sources: ['src/a.mjs'], runtimeEvidence: 'not-probed' }]);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
});
test('output is stable across input order and rejects paths outside the repository', () => {
  const a = { 'src/b.mjs': '', 'src/a.mjs': "import './b.mjs';" };
  assert.deepEqual(buildRouteReferenceInventory(a), buildRouteReferenceInventory(Object.fromEntries(Object.entries(a).reverse())));
  assert.throws(() => buildRouteReferenceInventory({ '../private.mjs': '' }), /Repository-relative/);
  assert.throws(() => buildRouteReferenceInventory({ '/private.mjs': '' }), /Repository-relative/);
});

test('fixture strings, comments and generated templates are not parsed as module imports', () => {
  const result = buildRouteReferenceInventory({ 'src/a.mjs': [
    "// import './comment.mjs';", "const example=\"import './fixture.mjs';\";",
    "const generated=`import './generated.mjs';`;", "import './actual.mjs';",
  ].join('\n'), 'src/actual.mjs': '' });
  assert.deepEqual(result.unresolvedModuleReferences, []);
  assert.equal(result.routes.find(x => x.path === 'src/actual.mjs').referencedBy[0].kind, 'module-specifier');
});
test('a workflow trigger is a declared entrypoint even without incoming path references', () => {
  const result = buildRouteReferenceInventory({ '.github/workflows/extra.yml': 'on:\n  workflow_dispatch:' });
  assert.equal(result.routes[0].classification, 'declared-workflow-entrypoint');
  assert.equal(result.routes[0].deletionEligible, false);
});

test('literal template dynamic imports are checked while interpolated targets remain unknown', () => {
  const result = buildRouteReferenceInventory({ 'src/a.mjs': [
    'import(`./present.mjs`);', 'import(`./missing.mjs`);', 'import(`./${name}.mjs`);',
  ].join('\n'), 'src/present.mjs': '' });
  assert.equal(result.routes.find(x => x.path === 'src/present.mjs').referencedBy[0].kind, 'module-specifier');
  assert.deepEqual(result.unresolvedModuleReferences, [{ source: 'src/a.mjs', line: 2, specifier: './missing.mjs' }]);
});

test('dot-prefixed workflow commands and local actions resolve from the repository root', () => {
  const result = buildRouteReferenceInventory({ '.github/workflows/a.yml':
    'run: node ./scripts/task.mjs\nuses: ./.github/actions/tool/action.yml',
    'scripts/task.mjs': '', '.github/actions/tool/action.yml': '',
  });
  const task = result.routes.find(x => x.path === 'scripts/task.mjs');
  assert.equal(task.classification, 'referenced-source');
  assert.equal(task.referencedBy[0].source, '.github/workflows/a.yml');
  assert.equal(result.summary.references, 2);
});

test('CLI reports deleted tracked paths and both file and parent symlink boundaries', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ultron-route-audit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of RETAINED_ROUTES) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), '');
  }
  for (const path of ['src/route-reference-audit.mjs', 'scripts/audit-route-references.mjs']) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), await readFile(new URL('../' + path, import.meta.url)));
  }
  const outside = join(root, 'outside.txt');
  await writeFile(outside, 'https://private-destination.example/credential');
  await symlink(outside, join(root, 'src/link.mjs'));
  await mkdir(join(root, 'cloud'));
  await writeFile(join(root, 'cloud/endpoint.mjs'), '');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', ...RETAINED_ROUTES, 'src', 'scripts', 'cloud'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Audit fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'], { cwd: root });
  const child = spawnSync(process.execPath, [join(root, 'scripts/audit-route-references.mjs')], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.source.workingTreeChanged, true); // outside.txt is untracked.
  assert.equal(result.omitted.find(x => x.path === 'src/link.mjs').reason, 'symlink-or-nonregular-or-oversize');
  assert.equal(result.routes.some(x => x.path === 'outside.txt'), false);
  assert.equal(child.stdout.includes('private-destination.example'), false);
  const outsideDir = await mkdtemp(join(tmpdir(), 'ultron-audit-outside-'));
  t.after(() => rm(outsideDir, { recursive: true, force: true }));
  await writeFile(join(outsideDir, 'endpoint.mjs'), 'https://outside-private.example/secret');
  await rm(join(root, 'cloud'), { recursive: true });
  await symlink(outsideDir, join(root, 'cloud'));
  await rm(join(root, '.github/workflows/verify.yml'));
  const changed = spawnSync(process.execPath, [join(root, 'scripts/audit-route-references.mjs')], { encoding: 'utf8' });
  assert.equal(changed.status, 1, changed.stderr);
  const changedResult = JSON.parse(changed.stdout);
  assert.ok(changedResult.missingRetainedRoutes.includes('.github/workflows/verify.yml'));
  assert.equal(changedResult.omitted.find(x => x.path === '.github/workflows/verify.yml').reason, 'missing-working-tree-file');
  assert.equal(changedResult.omitted.find(x => x.path === 'cloud/endpoint.mjs').reason, 'symlinked-parent');
  assert.equal(changed.stdout.includes('outside-private.example'), false);
});
