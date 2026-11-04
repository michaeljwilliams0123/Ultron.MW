// Public author labels and hashed route metadata, never credentials or account proof.
export const CODEX_AUTHORS = Object.freeze([
  { id: 'mike-codex', name: "Mike's Codex", aliases: ['mike', "mike's codex", 'mikes codex'],
    fingerprint: 'b4c3874f6b58cc1afb8f5f00172a9cb426657229037e493d1519084cc90b0418',
    binding: null, sessionObservation: null },
  { id: 'destiny-codex', name: "Destiny's Codex", aliases: ['destiny', "destiny's codex", 'destinys codex'],
    fingerprint: '550e01b316cfbd16729dd73a635cf6fc3343dcf682708b342d269e115fad14d9',
    binding: { kind: 'work-github-event',
      fingerprint: '1278bdf842ec4108ae053fa3656cc38fde798c7eabb10f19834ee74969ebdfbd',
      status: 'enrolled', enrolledAt: '2026-10-22T18:03:41.490Z', liveExecution: 'not-verified' },
    sessionObservation: { kind: 'work-session-observation', observedAt: '2026-10-22',
      environmentFingerprint: 'e3d831ecade612b04c554d9bc598625ef5717355b027702890bc12a2747308d6',
      threadFingerprint: '42fb2a1e66dcdd5eceaf89713554608c27fbfcc1e9a10ffda5a633dc87f685c5',
      accountAuthenticated: false } },
].map(author => Object.freeze({ ...author, aliases: Object.freeze(author.aliases),
  binding: author.binding && Object.freeze(author.binding),
  sessionObservation: author.sessionObservation && Object.freeze(author.sessionObservation) })));

const normalizeAuthorRoute = value =>
  value.trim().toLowerCase().replaceAll('\u2019', "'");

export function resolveCodexAuthor(name, { requireBinding = false,
  authors = CODEX_AUTHORS } = {}) {
  if (typeof name !== 'string') throw Error('Unknown Codex author');
  const normalized = normalizeAuthorRoute(name);
  const matches = authors.filter(author => [author.id, author.name, ...author.aliases]
    .some(route => normalizeAuthorRoute(route) === normalized));
  if (matches.length !== 1) throw Error('Unknown Codex author; use a registered author ID');
  const author = matches[0];
  if (requireBinding && author.binding?.status !== 'enrolled')
    throw Error(author.name + ' is not bound. Enroll it from its own Work account first.');
  return author;
}

export function parseCodexObjective(text, { authors = CODEX_AUTHORS } = {}) {
  if (typeof text !== 'string') throw Error('Invalid Codex objective');
  // Exact command prefix prevents accidental dispatch from ordinary prose.
  if (!/^\/codex(?:\s|$)/i.test(text)) return null;
  const match = /^\/codex ([a-z][a-z0-9-]{2,63}) (.+)$/i.exec(text);
  if (!match || /[\u0000-\u001f\u007f]/.test(text) || text.length > 1000 || text !== text.trim())
    throw Error('Use /codex <registered-author-id> <one public task>');
  const author = resolveCodexAuthor(match[1], { requireBinding: true, authors });
  if (match[2] !== match[2].trim()) throw Error('Invalid Codex task spacing');
  return Object.freeze({ author, objective: match[2] });
}
