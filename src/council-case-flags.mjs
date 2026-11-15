/** Council risk flags. For pull requests, the trusted main-only workflow
 * derives security sensitivity from GitHub's complete changed-file list.
 * A PR title/body can be misleading and must not substitute for this signal.
 * Missing/malformed trusted evidence is an automatic hold, never a clean PR.
 * This module only classifies risk; it does not authorize a merge or release.
 */
export function deriveCouncilFlags({title='',body='',isPr=false,originalSecuritySignal}={}){
 const lower=(String(title)+'\n'+String(body)).toLowerCase();
 const securityWords=['secret','credential','token','password','bypass security',
  'fail-open','delete main','force push'];
 const security=isPr
  ? originalSecuritySignal!=='0'
  : securityWords.some(word=>lower.includes(word));
 return Object.freeze({
  security,
  autonomy:['autonomy','always-on','unattended','self-merge','auto-merge']
   .some(word=>lower.includes(word)),
  multiFile:['multi-file','multifile','across the codebase','refactor']
   .some(word=>lower.includes(word)),
  infra:/\b(workflow|github actions|ci|deploy)\b/.test(lower)
 });
}
