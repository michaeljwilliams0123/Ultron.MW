/** External accounts are granted by their owners, not by GitHub comments. */
const PLANS=Object.freeze({
  github:Object.freeze({
    mode:'github-actions-ephemeral',reference:'GITHUB_TOKEN',
    scopes:['contents:write','pull-requests:write','actions:write'],
    next:'Trusted GitHub Actions jobs receive a scoped ephemeral credential from GitHub.',
  }),
  datadog:Object.freeze({
    mode:'owner-authorized-api-key',reference:'ULTRON_DATADOG_API_KEY',
    scopes:['logs:write'],
    next:'Authorize a Datadog API key for log ingestion, set GitHub secret ULTRON_DATADOG_API_KEY, configure ULTRON_ENABLE_DATADOG=1 and approved ULTRON_DATADOG_SITE.',
  }),
  huggingface:Object.freeze({
    mode:'local-public-model',reference:null,
    scopes:['public-model-inference'],
    next:'Pinned public CPU inference needs no provider key. Private or gated models require a separate explicitly authorized provider grant.',
  }),
});
export function providerAuthorizationPlan(provider,{env={}}={}) {
  const name=typeof provider==='string'?provider.toLowerCase():'';
  const p=PLANS[name];
  if(!p)throw Error('Unsupported provider authorization plan');
  const configured=name==='github'||name==='huggingface'||(
    typeof env[p.reference]==='string'&&env[p.reference].length>=16 &&
    env.ULTRON_ENABLE_DATADOG==='1');
  return Object.freeze({
    provider:name,mode:p.mode,reference:p.reference,requestedScopes:p.scopes,
    status:name==='github'?'workflow-identity':
      name==='huggingface'?'local-public':
      configured?'configured-not-verified':'requires-owner-authorization',
    next:p.next,credentialValue:null,
  });
}
export function supportedProviders(){return Object.keys(PLANS);}
