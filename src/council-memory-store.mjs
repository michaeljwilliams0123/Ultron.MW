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
import { councilScorecard, restoreCouncilMemory, scorecardRows, SCORECARD_COLUMNS } from './council-of-ultron.mjs';
import * as pg from '../cloud/hatchable/lib/council-memory.js';

const fail = code => { throw Object.assign(new Error('council-memory-store-' + code), { code }); };
export const ADAPTERS = Object.freeze(['snapshot', 'hatchable-postgres']);
export const MIRRORS = Object.freeze(['gitlab-mirror', 'gitbook-publish']);

/** In-repo snapshot adapter (always available; this is the export format). */
function snapshotAdapter() {
  return Object.freeze({
    name: 'snapshot',
    async save(memory) { return memory.snapshot(); },
    async load(snapshot, options) { return restoreCouncilMemory(snapshot, options); },
  });
}

/** Hatchable PostgreSQL adapter. Off unless mode is exactly "postgres" and a db client is given. */
function postgresAdapter({ db, mode }) {
  if (pg.memoryMode(mode) !== 'postgres' || !db || typeof db.query !== 'function') fail('postgres-disabled');
  return Object.freeze({
    name: 'hatchable-postgres',
    /** Import, then export, verify by restoring into a scratch memory, and only then
     * store the snapshot and the scorecard generation. Prior state stays until this verifies. */
    async save(memory) {
      const source = memory.snapshot();
      await pg.importSnapshot(db, source);
      const exported = await pg.exportSnapshot(db);
      const scratch = restoreCouncilMemory(exported.snapshot);
      if (scratch.snapshot().sha256 !== exported.snapshot.sha256) fail('verify-failed');
      await pg.storeVerifiedSnapshot(db, exported);
      const rows = scorecardRows(councilScorecard(scratch), exported.snapshot.sha256);
      if (rows.length) await pg.writeScorecardGeneration(db, rows.map(r => ({ ...r })));
      return exported.snapshot;
    },
    async load(options) {
      const { snapshot } = await pg.exportSnapshot(db);
      return restoreCouncilMemory(snapshot, options);
    },
  });
}

export function createCouncilMemoryStore({ adapter = 'snapshot', db = null, mode = 'off' } = {}) {
  if (adapter === 'snapshot') return snapshotAdapter();
  if (adapter === 'hatchable-postgres') return postgresAdapter({ db, mode });
  fail('adapter-unknown');
}

/** The persisted scorecard columns must match the src contract exactly. */
export const scorecardContractMatches = () =>
  JSON.stringify(SCORECARD_COLUMNS.map(c => c.name)) === JSON.stringify(pg.SCORECARD_COLUMN_NAMES);

function verified(snapshot) {
  pg.verifySnapshot(snapshot);
  return snapshot;
}

/** GitLab mirror plan: a file for a GitHub PR; gitlab-mirror.yml carries it after Verify. */
export function planGitLabMirror(snapshot) {
  const s = verified(snapshot);
  return Object.freeze({
    adapter: 'gitlab-mirror', enabled: false, executes: false,
    path: 'evidence/council-memory/' + s.sha256 + '.json',
    content: JSON.stringify(s, null, 2) + '\n',
    route: 'Commit by PR to GitHub main; the existing gitlab-mirror.yml fast-forwards GitLab after Verify (needs ULTRON_GITLAB_MIRROR_ENABLED=true and ULTRON_GITLAB_MIRROR_TOKEN, both already defined).',
  });
}

const MEMBER_NAMES = Object.freeze({
  'ultron-core': 'Ultron Core', 'ultron-builder': 'Builder', 'ultron-skeptic': 'Skeptic', 'ultron-steward': 'Steward',
  'ultron-predictor': 'Predictor', 'ultron-generator': 'Generator', 'ultron-sentinel': 'Sentinel', 'ultron-companion': 'Companion',
});
const md = value => String(value).replace(/[<>]/g, '').replace(/([\\`*_[\]|#])/g, '\\$1');

/** Human-readable journal for GitBook (Git Sync publishes gitbook/ from main). */
export function renderGitBookJournal(snapshot, { maxPerMember = 20 } = {}) {
  const s = verified(snapshot);
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

export function planGitBookPublish(snapshot) {
  return Object.freeze({
    adapter: 'gitbook-publish', enabled: false, executes: false,
    path: 'gitbook/council-journal.md', content: renderGitBookJournal(snapshot),
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
