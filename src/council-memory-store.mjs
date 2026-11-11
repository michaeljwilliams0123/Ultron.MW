/** Council of Ultron Phase 2: storage adapters for council memory.
 *
 * Primary: Hatchable PostgreSQL (migration 0043, cloud/hatchable/lib/council-memory.js).
 * Export: the in-repo `ultron.council-memory.v1` snapshot (tamper-evident).
 * Mirrors (designed, disabled by default): GitLab for git-backed snapshots and
 * GitBook for the human-readable journal. Both go through files committed to
 * GitHub `main` by PR, so the existing gitlab-mirror.yml workflow and GitBook
 * Git Sync (gitbook/ directory) carry them. No adapter writes to GitLab or
 * GitBook directly, and no new credential is needed.
 *
 * Every adapter fails closed and defaults off. Memory is advisory: nothing here
 * grants authority, executes an operation or counts as an approval.
 */
import { restoreCouncilMemory, scorecardRows, SCORECARD_COLUMNS } from './council-of-ultron.mjs';
import * as pg from '../cloud/hatchable/lib/council-memory.js';

const fail = code => { throw Object.assign(new Error('council-memory-store-' + code), { code }); };
export const ADAPTERS = Object.freeze(['snapshot', 'hatchable-postgres']);
export const MIRRORS = Object.freeze(['gitlab-mirror', 'gitbook-publish']);

/** Re-run the write-path validators on any snapshot before restoring it, so a
 * resealed snapshot cannot smuggle prototype keys or credential-like text. */
export function validatedRestore(snapshot, options) {
  pg.verifySnapshot(snapshot);
  pg.entriesFromSnapshot(snapshot).forEach(pg.validateEntry);
  return restoreCouncilMemory(snapshot, options);
}

/** In-repo snapshot adapter (always available; this is the export format). */
function snapshotAdapter() {
  return Object.freeze({
    name: 'snapshot',
    async save(memory) { return memory.snapshot(); },
    async load(snapshot, options) { return validatedRestore(snapshot, options); },
  });
}

/** Hatchable PostgreSQL adapter. Off unless mode is exactly "postgres", a db
 * client is given and an HMAC key (>= 32 bytes, base64) is configured. */
function postgresAdapter({ db, mode, hmacKey }) {
  if (pg.memoryMode(mode) !== 'postgres' || !db || typeof db.query !== 'function') fail('postgres-disabled');
  const key = pg.hmacKey(hmacKey);
  return Object.freeze({
    name: 'hatchable-postgres',
    /** Seal, import, export, verify by restoring into a scratch memory, and only
     * then store the snapshot and the scorecard. Prior state stays until this verifies. */
    async save(memory) {
      const source = memory.snapshot();
      await pg.importSnapshot(db, pg.sealSnapshot(source, key), key);
      const exported = await pg.exportSnapshot(db);
      const scratch = validatedRestore(exported.snapshot);
      if (scratch.snapshot().sha256 !== exported.snapshot.sha256) fail('verify-failed');
      await pg.storeVerifiedSnapshot(db, exported, key);
      // Only outcomes whose evidence was independently verified count.
      const rows = scorecardRows(pg.verifiedScorecard(exported.snapshot), exported.snapshot.sha256);
      if (rows.length) await pg.writeScorecardGeneration(db, rows.map(r => ({ ...r })));
      return exported.snapshot;
    },
    async load(options) {
      const { snapshot } = await pg.exportSnapshot(db);
      return validatedRestore(snapshot, options);
    },
    seal: snapshot => pg.sealSnapshot(snapshot, key),
  });
}

export function createCouncilMemoryStore({ adapter = 'snapshot', db = null, mode = 'off', hmacKey = null } = {}) {
  if (adapter === 'snapshot') return snapshotAdapter();
  if (adapter === 'hatchable-postgres') return postgresAdapter({ db, mode, hmacKey });
  fail('adapter-unknown');
}

/** The persisted scorecard columns must match the src contract exactly. */
export const scorecardContractMatches = () =>
  JSON.stringify(SCORECARD_COLUMNS.map(c => c.name)) === JSON.stringify(pg.SCORECARD_COLUMN_NAMES);

/** Mirrors only accept a sealed snapshot whose HMAC verifies (fail closed). */
function verified(sealed, rawKey) {
  return pg.openSealed(sealed, pg.hmacKey(rawKey));
}

/** GitLab mirror plan: a file for a GitHub PR; gitlab-mirror.yml carries it after Verify. */
export function planGitLabMirror(sealed, rawKey) {
  verified(sealed, rawKey);
  const s = sealed.snapshot;
  return Object.freeze({
    adapter: 'gitlab-mirror', enabled: false, executes: false,
    path: 'evidence/council-memory/' + s.sha256 + '.json',
    content: JSON.stringify(sealed, null, 2) + '\n',
    route: 'Commit by PR to GitHub main; the existing gitlab-mirror.yml fast-forwards GitLab after Verify (needs ULTRON_GITLAB_MIRROR_ENABLED=true and ULTRON_GITLAB_MIRROR_TOKEN, both already defined).',
  });
}

const MEMBER_NAMES = Object.freeze({
  'ultron-core': 'Ultron Core', 'ultron-builder': 'Builder', 'ultron-skeptic': 'Skeptic', 'ultron-steward': 'Steward',
  'ultron-predictor': 'Predictor', 'ultron-generator': 'Generator', 'ultron-sentinel': 'Sentinel', 'ultron-companion': 'Companion',
});
const md = value => String(value).replace(/[<>]/g, '').replace(/([\\`*_[\]|#])/g, '\\$1');

/** Human-readable journal for GitBook (Git Sync publishes gitbook/ from main). */
export function renderGitBookJournal(sealed, rawKey, { maxPerMember = 20 } = {}) {
  const s = verified(sealed, rawKey);
  const out = ['---', 'description: "Council of Ultron journal, generated from a verified memory snapshot."', '---',
    '# Council journal', '', 'Snapshot `' + s.sha256 + '` (`' + s.schema + '`). Advisory memory, not approvals.', ''];
  out.push('## Shared memory', '');
  if (!s.shared.length) out.push('_No shared facts yet._', '');
  for (const f of s.shared.slice(-50)) out.push('- ' + f.at + ' · ' + MEMBER_NAMES[f.by] + ': ' + md(f.fact) +
    ' (' + f.evidence.map(e => e.startsWith('https://') ? '[evidence](' + e + ')' : '`' + e + '`').join(', ') + ')');
  out.push('');
  for (const [id, slot] of Object.entries(s.members)) {
    const facts = Object.entries(slot.profile);
    if (!facts.length && !slot.journal.length) continue;
    out.push('## ' + MEMBER_NAMES[id] + ' (`' + slot.namespace + '`)', '');
    for (const [key, f] of facts) out.push('- **' + md(key) + '**: ' + md(f.value));
    for (const j of slot.journal.slice(-maxPerMember)) out.push('- ' + j.at + ' · ' + md(j.kind) + (j.outcome ? ' · ' + j.outcome : '') + ': ' + md(j.text));
    out.push('');
  }
  return out.join('\n');
}

export function planGitBookPublish(sealed, rawKey) {
  return Object.freeze({
    adapter: 'gitbook-publish', enabled: false, executes: false,
    path: 'gitbook/council-journal.md', content: renderGitBookJournal(sealed, rawKey),
    route: 'Commit by PR to GitHub main; GitBook Git Sync (project directory gitbook/) publishes it. No GitBook API token.',
  });
}

/** Direct GitLab/GitBook API writes are intentionally not implemented. */
export function mirrorAdapter(name) {
  if (!MIRRORS.includes(name)) fail('mirror-unknown');
  return Object.freeze({
    name, enabled: false,
    plan: name === 'gitlab-mirror' ? planGitLabMirror : planGitBookPublish,
    async write() { fail('mirror-direct-write-disabled'); },
  });
}
