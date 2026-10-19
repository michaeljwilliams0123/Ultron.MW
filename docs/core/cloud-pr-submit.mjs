// Pages never receives GitHub credentials. The signed-in owner confirms a
// native GitHub Issue, and GitHub Actions publishes the source PR to main.
export const CLOUD_PR_ISSUES = 'https://github.com/michaeljwilliams0123/Ultron.MW/issues/new';
export function createCloudPrUrl(objective) {
  if (typeof objective !== 'string' || !objective.trim())
    throw Error('Enter an objective or a code-change manifest.');
  let title = '[Ultron PR] Create proposal';
  let body = 'ULTRON_PR_V1\n' + objective;
  if (objective.trim().startsWith('{')) {
    let manifest;
    try { manifest=JSON.parse(objective); }
    catch { throw Error('Invalid JSON code-change manifest.'); }
    if (typeof manifest?.objective !== 'string' || !manifest.objective.trim() ||
      !/^[0-9a-f]{40}$/.test(manifest.baseSha||'') ||
      !Array.isArray(manifest.changes) || manifest.changes.length < 1 ||
      manifest.changes.length > 8)
      throw Error('Code changes require objective, baseSha and 1–8 source edits.');
    if (objective.length > 30000)
      throw Error('Public code manifest exceeds 30,000 characters.');
    title = '[Ultron PR] Implement code';
    body = 'ULTRON_CODE_PR_V1\n' + JSON.stringify(manifest);
  } else if (objective !== objective.trim() || objective.length > 1000 ||
    /[\r\n\u0000-\u001f]/.test(objective)) {
    throw Error('Enter one public PR objective line (1–1000 characters).');
  }
  return CLOUD_PR_ISSUES + '?' + new URLSearchParams({title,body}).toString();
}
