import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A missing or broken test-only database dependency must not silently skip
// integration coverage in CI, where locked dependencies are installed.
for (const file of ['hatchable-actions-grant-pglite.test.mjs',
 'hatchable-partial-migration.test.mjs']) {
 test(file + ' fails CI if PGlite cannot load', async () => {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const importCall = "await import('@electric-sql/pglite')";
  assert.ok(source.includes(importCall), 'test must inject the actual import');
  const injected = source.replace(importCall,
   "await Promise.reject(new Error('simulated-pglite-import-failure'))");
  const previous = process.env.CI;
  process.env.CI = 'true';
  try {
   await assert.rejects(
    import('data:text/javascript;base64,'+
     Buffer.from(injected).toString('base64')),
    /pglite.*(unavailable|failed|required)|simulated-pglite-import-failure/i
   );
  } finally {
   if (previous === undefined) delete process.env.CI;
   else process.env.CI = previous;
  }
 });
}
