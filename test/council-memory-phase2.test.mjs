import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createCouncilMemory, restoreCouncilMemory, routeCouncilTask, recordCouncilOutcome, councilScorecard,
  SCORECARD_COLUMNS, scorecardRows,
} from '../src/council-of-ultron.mjs';
import { snapshotSha } from '../src/git-hubs.mjs';
import * as pg from '../cloud/hatchable/lib/council-memory.js';
import {
  createCouncilMemoryStore, scorecardContractMatches, planGitLabMirror, planGitBookPublish, renderGitBookJournal, mirrorAdapter,
} from '../src/council-memory-store.mjs';

let PGlite = null;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {}
const skip = PGlite ? false : '@electric-sql/pglite not installed';
const EV = 'https://github.com/michaeljwilliams0123/Ultron.MW/pull/403';
const MIGRATION = new URL('../cloud/hatchable/migrations/0043_council_memory.sql', import.meta.url);

function seededMemory() {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 10, 11, 5, 0, tick++)).toISOString();
  const memory = createCouncilMemory({ now });
  memory.remember('ultron-companion', 'owner.timezone', 'America/New_York');
  memory.remember('ultron-companion', 'owner.timezone', 'America/New_York (EST)');
  memory.journal('ultron-sentinel', { kind: 'observation', text: 'verify.yml failed 35% of PR runs over 14 days', lane: 'reliability', evidence: [EV] });
  memory.share('ultron-predictor', { fact: 'Comment-triggered runs that execute fail 39% of the time', evidence: [EV] });
  const routing = routeCouncilTask({ id: 'task-ci-1', objective: 'Fix the flaky CI workflow' }, { memory });
  recordCouncilOutcome(memory, routing, { status: 'succeeded', evidence: [EV] });
  return memory;
}
async function freshDb() {
  const db = new PGlite();
  await db.exec(await readFile(MIGRATION, 'utf8'));
  return db;
}

test('scorecard column contract is named in src and matched by the Hatchable store', async () => {
  assert.deepEqual(SCORECARD_COLUMNS.map(c => c.name), ['member_id', 'lane', 'attempts', 'successes', 'rate', 'snapshot_sha256']);
  assert.ok(scorecardContractMatches());
  const sql = await readFile(MIGRATION, 'utf8');
  for (const { name } of SCORECARD_COLUMNS) assert.match(sql, new RegExp('\\n ' + name + ' '), name);
  const memory = seededMemory();
  const rows = scorecardRows(councilScorecard(memory), memory.snapshot().sha256);
  assert.ok(rows.length >= 1);
  for (const row of rows) assert.deepEqual(Object.keys(row), SCORECARD_COLUMNS.map(c => c.name));
  assert.throws(() => scorecardRows({}, 'nope'), /scorecard-snapshot-invalid/);
});

test('Hatchable store hashes exactly like the in-repo snapshot and refuses mismatches', () => {
  const snap = seededMemory().snapshot();
  const { sha256, ...body } = snap;
  assert.equal(pg.sha256Of(body), snapshotSha(body));
  assert.equal(pg.sha256Of(body), sha256);
  assert.throws(() => pg.verifySnapshot({ ...snap, schema: 'ultron.council-memory.v0' }), /schema-mismatch/);
  assert.throws(() => pg.verifySnapshot({ ...snap, shared: [] }), /digest-mismatch/);
});

test('one writer per key-space and credential-like text are rejected before any write', () => {
  const at = '2026-11-11T05:00:00.000Z';
  const fact = { memberId: 'ultron-builder', kind: 'fact', factKey: 'k1', body: { value: 'v', at } };
  assert.ok(pg.validateEntry({ ...fact, writtenBy: 'ultron-builder' }));
  assert.throws(() => pg.validateEntry({ ...fact, writtenBy: 'ultron-sentinel' }), /writer-not-owner/);
  assert.throws(() => pg.validateEntry({ ...fact, writtenBy: 'ultron-builder', body: { value: 'ghp_' + 'a'.repeat(30), at } }), /credential-like/);
  assert.throws(() => pg.validateEntry({ memberId: 'ultron-builder', writtenBy: 'ultron-builder', kind: 'outcome',
    body: { at, routing: 'a'.repeat(64), lead: 'ultron-builder', lanes: ['agentic'], status: 'succeeded', evidence: [EV] } }), /writer-not-owner/);
  assert.throws(() => pg.validateEntry({ memberId: 'ultron-admin', writtenBy: 'ultron-admin', kind: 'fact', factKey: 'k1', body: { value: 'v', at } }), /member-unknown/);
});

test('adapters fail closed and default off; mirrors never write directly', async () => {
  assert.equal(pg.memoryMode(undefined), 'off');
  assert.equal(pg.memoryMode('Postgres'), 'off');
  assert.equal(pg.memoryMode('postgres'), 'postgres');
  assert.throws(() => createCouncilMemoryStore({ adapter: 'hatchable-postgres', db: { query() {} } }), /postgres-disabled/);
  assert.throws(() => createCouncilMemoryStore({ adapter: 'hatchable-postgres', mode: 'postgres' }), /postgres-disabled/);
  assert.throws(() => createCouncilMemoryStore({ adapter: 'gitlab' }), /adapter-unknown/);
  assert.equal(createCouncilMemoryStore().name, 'snapshot');
  for (const name of ['gitlab-mirror', 'gitbook-publish']) {
    const m = mirrorAdapter(name);
    assert.equal(m.enabled, false);
    await assert.rejects(() => m.write(), /mirror-direct-write-disabled/);
  }
});

test('git-carried mirror plans: snapshot file for GitLab, journal page for GitBook', () => {
  const snap = seededMemory().snapshot();
  const lab = planGitLabMirror(snap);
  assert.equal(lab.path, 'evidence/council-memory/' + snap.sha256 + '.json');
  assert.equal(lab.executes, false);
  assert.deepEqual(restoreCouncilMemory(JSON.parse(lab.content)).snapshot().sha256, snap.sha256);
  const book = planGitBookPublish(snap);
  assert.equal(book.path, 'gitbook/council-journal.md');
  assert.match(book.content, /# Council journal/);
  assert.match(book.content, /Sentinel \(`council\/sentinel`\)/);
  assert.match(book.content, /owner\.timezone\*\*: America\/New\\_York \(EST\)/);
  assert.throws(() => renderGitBookJournal({ ...snap, sha256: 'f'.repeat(64) }), /digest-mismatch/);
});

test('round trip: export, import into Postgres, export, restore into scratch, diff', { skip }, async () => {
  const memory = seededMemory();
  const original = memory.snapshot();
  const db = await freshDb();
  const first = await pg.importSnapshot(db, original);
  assert.equal(first.inserted, first.entries);
  assert.equal((await pg.importSnapshot(db, original)).inserted, 0, 'replay is a no-op');
  const { snapshot, lastEntryId } = await pg.exportSnapshot(db);
  assert.equal(snapshot.sha256, original.sha256);
  assert.deepEqual(snapshot, JSON.parse(JSON.stringify(original)));
  const scratch = restoreCouncilMemory(snapshot);
  assert.deepEqual(scratch.snapshot(), original);
  assert.deepEqual(councilScorecard(scratch), councilScorecard(memory));
  assert.ok(lastEntryId > 0);
});

test('Postgres adapter verifies before storing; scorecard generations are append-only', { skip }, async () => {
  const db = await freshDb();
  const store = createCouncilMemoryStore({ adapter: 'hatchable-postgres', db, mode: 'postgres' });
  const memory = seededMemory();
  const saved = await store.save(memory);
  assert.equal(saved.sha256, memory.snapshot().sha256);
  const loaded = await store.load();
  assert.equal(loaded.snapshot().sha256, saved.sha256);
  assert.deepEqual(await pg.readStoredSnapshot(db, saved.sha256), JSON.parse(JSON.stringify(saved)));
  const card = await pg.readCurrentScorecard(db);
  assert.deepEqual(card, scorecardRows(councilScorecard(memory), saved.sha256).map(r => ({ ...r })));
  // A newer generation becomes current without touching the previous one.
  memory.journal('ultron-builder', { kind: 'note', text: 'second generation' });
  const routing = routeCouncilTask({ id: 'task-ci-2', objective: 'Implement the retry fix' }, { memory });
  recordCouncilOutcome(memory, routing, { status: 'failed', evidence: [EV] });
  const second = await store.save(memory);
  assert.notEqual(second.sha256, saved.sha256);
  assert.equal((await pg.readCurrentScorecard(db))[0].snapshot_sha256, second.sha256);
  const gens = (await db.query('SELECT DISTINCT snapshot_sha256 FROM brain_council_scorecard_rows')).rows;
  assert.equal(gens.length, 2);
  for (const table of ['brain_council_memory_entries', 'brain_council_memory_snapshots', 'brain_council_scorecard_rows']) {
    await assert.rejects(() => db.query('DELETE FROM ' + table), /append-only/);
    await assert.rejects(() => db.query('UPDATE ' + table + ' SET created_at=now()'), /append-only/);
  }
});

test('database enforces row ownership even if the library is bypassed', { skip }, async () => {
  const db = await freshDb();
  const at = '2026-11-11T05:00:00.000Z';
  const insert = (member, writer, kind, factKey, body) => db.query(`INSERT INTO brain_council_memory_entries
    (entry_key,member_id,written_by,kind,fact_key,at_iso,body) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
  [pg.sha256Of({ member, writer, kind, body }), member, writer, kind, factKey, at, JSON.stringify(body)]);
  await insert('ultron-builder', 'ultron-builder', 'fact', 'k1', { value: 'v', at });
  await assert.rejects(() => insert('ultron-builder', 'ultron-skeptic', 'fact', 'k2', { value: 'v', at }), /check/i);
  await assert.rejects(() => insert('ultron-builder', 'ultron-builder', 'outcome', null, { at }), /check/i);
  await assert.rejects(() => insert('ultron-builder', 'ultron-builder', 'shared', null, { at, by: 'ultron-skeptic' }), /check/i);
  await assert.rejects(() => insert('ultron-root', 'ultron-root', 'journal', null, { at }), /check/i);
  await assert.rejects(() => pg.appendEntries(db, new Array(501).fill({})), /batch-invalid/);
});

test('memory route is owner-only, default off and touches no table when disabled', async () => {
  const source = await readFile(new URL('../cloud/hatchable/api/brain/council-memory.js', import.meta.url), 'utf8');
  const transformed = source
    .replace("import {db,config} from 'hatchable';", 'const {db,config}=globalThis.__memPlatform;')
    .replace("from 'lib/council-memory.js'", "from '" + new URL('../cloud/hatchable/lib/council-memory.js', import.meta.url).href + "'");
  const queries = [];
  globalThis.__memPlatform = { db: { async query(sql) { queries.push(sql); return { rows: [] }; } },
    config: { async get(name) { assert.equal(name, 'ULTRON_COUNCIL_MEMORY_MODE'); throw Error('unset'); } } };
  const route = await import('data:text/javascript;base64,' + Buffer.from(transformed).toString('base64'));
  const res = () => ({ code: 0, status(n) { this.code = n; return this; }, setHeader() {}, json(b) { return { status: this.code, body: b }; } });
  assert.equal(route.access, 'admin');
  assert.equal((await route.default({ method: 'GET', member: { handle: 'someone' } }, res())).status, 403);
  const off = await route.default({ method: 'GET', member: { handle: 'michaeljwilliams0123' } }, res());
  assert.equal(off.status, 409);
  assert.equal(off.body.error, 'council-memory-disabled');
  assert.equal(queries.length, 0);
  const toml = await readFile(new URL('../cloud/hatchable/hatchable.toml', import.meta.url), 'utf8');
  assert.match(toml, /name = "ULTRON_COUNCIL_MEMORY_MODE"\nrequired = false/);
  delete globalThis.__memPlatform;
});
