// Pages never receives a GitHub token. GitHub's authenticated Issue form
// is the explicit owner-confirmation step for a hosted PR operation.
export const CLOUD_PR_ISSUES = 'https://github.com/michaeljwilliams0123/Ultron.MW/issues/new';
export function createCloudPrUrl(objective) {
  if (typeof objective !== 'string' || objective !== objective.trim() ||
      objective.length < 1 || objective.length > 1000 ||
      /[\r\n\u0000-\u001f]/.test(objective))
    throw Error('Enter one public PR objective line (1–1000 characters).');
  const params = new URLSearchParams({
    title: '[Ultron PR] Create proposal',
    body: 'ULTRON_PR_V1\n' + objective,
  });
  return CLOUD_PR_ISSUES + '?' + params.toString();
}
