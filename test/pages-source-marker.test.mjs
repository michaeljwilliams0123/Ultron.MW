import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');

test('Pages publishes the GitHub Pages build revision for runtime parity', () => {
  assert.match(html, /^---\n---\n<!doctype html>/);
  assert.match(
    html,
    /<meta name="ultron-source-sha" content="{{ site\.github\.build_revision }}">/
  );
});
