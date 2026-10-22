import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// This dependency graph produced zero reported vulnerabilities in exact-head
// Verify run 39706366720. The project package version is deliberately omitted:
// it does not alter installed dependencies, and package.json remains authoritative.
const AUDITED_GRAPH_SHA256 = 'e11b69c25b76e88d0eda9acdffd9cc7761f348425ebfaf9c37f68d516e99f860';

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

const lock = JSON.parse(
  await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
);
const packages = structuredClone(lock.packages);
delete packages[''].version;

const graph = canonical({
  lockfileVersion: lock.lockfileVersion,
  requires: lock.requires,
  packages,
});
const actual = createHash('sha256')
  .update(JSON.stringify(graph))
  .digest('hex');

if (actual !== AUDITED_GRAPH_SHA256) {
  throw new Error(
    `Dependency graph ${actual} has not been audited; expected ${AUDITED_GRAPH_SHA256}`,
  );
}

console.log(`Audited dependency graph verified: ${actual}`);
