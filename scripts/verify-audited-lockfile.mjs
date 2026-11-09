import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Preserve the SHA-256 of the previously audited 2026-11-06 graph.
// The narrowly scoped Babel parser addition is separately pinned by exact
// version, tarball URL, SHA-512 integrity, license and dependency metadata.
// CI's npm audit is still required before the candidate can be accepted.
const AUDITED_BASELINE_SHA256 = '6ae127846592518ea3128f9ebd382f394bc34361c8636d5d4a8d2dd28ccbeb29';
const PARSER_PACKAGES = {
  'node_modules/@babel/helper-string-parser': {
    version: '7.29.7',
    resolved: 'https://registry.npmjs.org/@babel/helper-string-parser/-/helper-string-parser-7.29.7.tgz',
    integrity: 'sha512-Pb5ijPrZ89GDH8223L4UP8i6QApWxs04RbPQJTeWDV0/keR2E36MeKnyr6LYmUUvqRRI+Iv87SuF1W6ErINzYw==',
    dev: true, license: 'MIT', engines: { node: '>=6.9.0' },
  },
  'node_modules/@babel/helper-validator-identifier': {
    version: '7.29.7',
    resolved: 'https://registry.npmjs.org/@babel/helper-validator-identifier/-/helper-validator-identifier-7.29.7.tgz',
    integrity: 'sha512-qehxGkRj55h/ff8EMaJ+cYhyaKlHIxqYDn682wQD7RNp9UujOQsHog2uS0r2vzr4pW+sXf90NeeayjcNaX3fFg==',
    dev: true, license: 'MIT', engines: { node: '>=6.9.0' },
  },
  'node_modules/@babel/parser': {
    version: '7.29.9',
    resolved: 'https://registry.npmjs.org/@babel/parser/-/parser-7.29.9.tgz',
    integrity: 'sha512-CjXrNHTnvqBVqHgdBysY3vk2T8tpJHb5/RMeHJBTyVa9xgugCB0CJTx/3oO8RV2QRQP391RWpB7D6hLjm8V9uA==',
    dev: true, license: 'MIT',
    dependencies: { '@babel/types': '^7.29.8' },
    bin: { parser: 'bin/babel-parser.js' },
    engines: { node: '>=6.0.0' },
  },
  'node_modules/@babel/types': {
    version: '7.29.8',
    resolved: 'https://registry.npmjs.org/@babel/types/-/types-7.29.8.tgz',
    integrity: 'sha512-Vj1jF3cPfxg7OAfoI7QnVKLoILlm2JF9pnVHrX8qx7AHMiYWT+NDAA7jChlNgRS4WTLc/fD1lXLmPixluj+3Gg==',
    dev: true, license: 'MIT',
    dependencies: { '@babel/helper-string-parser': '^7.29.7', '@babel/helper-validator-identifier': '^7.29.7' },
    engines: { node: '>=6.9.0' },
  },
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packages = structuredClone(lock.packages);
if (manifest.devDependencies?.['@babel/parser'] !== '7.29.9' ||
    packages['']?.devDependencies?.['@babel/parser'] !== '7.29.9') {
  throw new Error('Unpinned AST parser dependency');
}
delete packages[''].devDependencies['@babel/parser'];
for (const [path, expected] of Object.entries(PARSER_PACKAGES)) {
  if (JSON.stringify(canonical(packages[path])) !== JSON.stringify(canonical(expected))) {
    throw new Error('Unrecognized AST parser dependency: ' + path);
  }
  delete packages[path];
}
delete packages[''].version;
const graph = canonical({
  lockfileVersion: lock.lockfileVersion,
  requires: lock.requires,
  packages,
});
const actual = createHash('sha256').update(JSON.stringify(graph)).digest('hex');
if (actual !== AUDITED_BASELINE_SHA256) {
  throw new Error('Baseline audited dependency graph changed: ' + actual);
}
console.log('Baseline dependency graph verified: ' + actual);
console.log('AST parser additions pinned; npm audit remains required in CI');
