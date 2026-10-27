import { posix } from 'node:path';

// Issue #69: these release, UI and recovery entrypoints cannot be inferred dead
// merely because no JavaScript module imports them.
export const RETAINED_ROUTES = Object.freeze([
  '.github/workflows/verify.yml', '.github/workflows/pr-brain.yml',
  '.github/workflows/cloud-pr.yml', '.github/workflows/cloud-objective.yml',
  '.github/workflows/self-scan-pr.yml', '.github/workflows/gitlab-mirror.yml',
  'docs/app.js', 'docs/index.html', 'scripts/mirror-gitlab.sh',
  'gitbook-docs.yaml', 'gitbook/.gitbook.yaml',
]);
const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isRoute = path => RETAINED_ROUTES.includes(path) ||
  /^(src|scripts|cloud)\/.*\.(mjs|js|sh|json|yml|yaml|sql)$/.test(path) ||
  /^docs\/.*\.(mjs|js|html|css)$/.test(path) ||
  /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);
const lineAt = (text, index) => text.slice(0, index).split('\n').length;
function moduleSpecifiers(text) {
  const tokens = [];
  for (let i = 0; i < text.length;) {
    const start = i, c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (text.startsWith('//', i)) { i = text.indexOf('\n', i + 2); if (i < 0) break; continue; }
    if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let value = ''; i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') { i++; if (i < text.length) value += text[i++]; }
        else value += text[i++];
      }
      i++;
      tokens.push({ type: c === '`' ? 'template' : 'string', value, index: start });
    } else if (/[a-zA-Z_$]/.test(c)) {
      i++; while (i < text.length && /[a-zA-Z0-9_$]/.test(text[i])) i++;
      tokens.push({ type: 'word', value: text.slice(start, i), index: start });
    } else { tokens.push({ type: 'punctuation', value: c, index: i++ }); }
  }
  const found = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], next = tokens[i + 1];
    if (token.type !== 'word' || !['import', 'export'].includes(token.value) || tokens[i - 1]?.value === '.') continue;
    if (token.value === 'import' && next?.type === 'string')
      found.push({ specifier: next.value, index: token.index });
    else if (token.value === 'import' && next?.value === '(' && tokens[i + 2]?.type === 'string' && [')', ','].includes(tokens[i + 3]?.value))
      found.push({ specifier: tokens[i + 2].value, index: token.index });
    else if (next?.value === '{' || next?.value === '*' || token.value === 'import' && next?.type === 'word') {
      for (let j = i + 1; j < tokens.length && tokens[j].value !== ';'; j++) {
        if (tokens[j].type === 'word' && tokens[j].value === 'from' && tokens[j + 1]?.type === 'string') {
          found.push({ specifier: tokens[j + 1].value, index: token.index }); break;
        }
      }
    }
  }
  return found;
}
function resolveReference(source, specifier, paths) {
  let value;
  try { value = decodeURIComponent(specifier.split(/[?#]/, 1)[0]); }
  catch { return null; }
  if (!value || value.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  const candidates = value.startsWith('.')
    ? [posix.join(posix.dirname(source), value)]
    : [value.replace(/^\//, ''), posix.join(posix.dirname(source), value)];
  return candidates.map(path => posix.normalize(path)).find(path =>
    !path.startsWith('../') && paths.has(path)) || null;
}

/** Static references are evidence of a consumer, never proof of live service.
 * No deletion, network probe, credential read or deployment is performed. */
export function buildRouteReferenceInventory(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files) ||
      Object.entries(files).some(([path, text]) => typeof text !== 'string' ||
        !path || path.startsWith('/') || path.includes('\\') ||
        path.split('/').includes('..')))
    throw Error('Repository-relative source texts required');
  const paths = Object.keys(files).sort(byText), pathSet = new Set(paths);
  const edges = new Map(), unresolved = [], endpoints = new Map();
  function record(source, specifier, index, kind) {
    const target = resolveReference(source, specifier, pathSet);
    if (!target || target === source) return target;
    const edge = { source, line: lineAt(files[source], index), target, kind };
    const key = [source, edge.line, target].join(':');
    // A parsed import is stronger evidence than another literal on the line.
    if (!edges.has(key) || kind === 'module-specifier') edges.set(key, edge);
    return target;
  }
  for (const source of paths) {
    const text = files[source];
    if (/\.(mjs|js)$/.test(source)) for (const match of moduleSpecifiers(text)) {
      if (!match.specifier.startsWith('.')) continue;
      if (!record(source, match.specifier, match.index, 'module-specifier'))
        unresolved.push({ source, line: lineAt(text, match.index), specifier: match.specifier.split(/[?#]/, 1)[0] });
    }
    const references = /https?:\/\/[^\s"'`<>()]+|(?:\.{0,2}\/)?[a-zA-Z0-9_@.-]+(?:\/[a-zA-Z0-9_@.-]+)*\.(?:mjs|js|json|ya?ml|sh|html|css|sql|md)(?:[?#][^\s"'`<>)]*)?/g;
    for (const match of text.matchAll(references)) {
      if (/^https?:/.test(match[0])) {
        try {
          const origin = new URL(match[0]).origin;
          const sources = endpoints.get(origin) || new Set();
          sources.add(source); endpoints.set(origin, sources);
        } catch { /* An incomplete template is not a verified endpoint. */ }
        continue;
      }
      record(source, match[0], match.index, source.startsWith('.github/workflows/')
        ? 'workflow-reference' : /\.(md|html)$/.test(source) ? 'document-link' : 'text-reference');
    }
  }
  const references = [...edges.values()].sort((a, b) =>
    byText(a.target, b.target) || byText(a.source, b.source) || a.line - b.line);
  const routes = paths.filter(isRoute).map(path => {
    const referencedBy = references.filter(edge => edge.target === path);
    const retained = RETAINED_ROUTES.includes(path);
    const workflowEntrypoint = /^\.github\/workflows\//.test(path) && /^on\s*:/m.test(files[path]);
    return { path, classification: retained ? 'retained-entrypoint' :
      workflowEntrypoint ? 'declared-workflow-entrypoint' :
      referencedBy.length ? 'referenced-source' : 'unreferenced-candidate',
      referencedBy, runtimeEvidence: 'not-probed', deletionEligible: false };
  });
  return {
    schema: 'ultron.route-reference-audit.v1',
    summary: { files: paths.length, routes: routes.length, references: references.length,
      unreferencedCandidates: routes.filter(x => x.classification === 'unreferenced-candidate').length },
    routes,
    unresolvedModuleReferences: unresolved.sort((a, b) => byText(a.source, b.source) || a.line - b.line),
    missingRetainedRoutes: RETAINED_ROUTES.filter(path => !pathSet.has(path)),
    // Only origins are emitted, never URL credentials, paths, query or fragments.
    endpointOrigins: [...endpoints].sort(([a], [b]) => byText(a, b))
      .map(([origin, sources]) => ({ origin, sources: [...sources].sort(byText), runtimeEvidence: 'not-probed' })),
  };
}
