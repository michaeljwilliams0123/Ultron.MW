// Implemented deterministic tools only. Registry entries never grant authority
// to a model, certify deployment, or replace the executor's live checks.
export const CAPABILITY_SCHEMA='ultron.capabilities.v1';
export const CAPABILITIES=Object.freeze([
  {id:'help',command:'/help',description:'List supported read-only commands',
    localScope:'Local command catalogue',cloudScope:'Hosted command catalogue'},
  {id:'system-status',command:'/system status',description:'Inspect the executing runtime',
    localScope:'Current loopback Node runtime',cloudScope:'Current ephemeral Actions runner'},
  {id:'repo-inspect',command:'/repo inspect',description:'Inspect Ultron repository structure',
    localScope:'Fixed project entries in the local checkout',cloudScope:'Authoritative GitHub main tree'},
  {id:'learning-status',command:'/learning status',description:'Read learning evidence status',
    localScope:'Persisted local evidence ledger',cloudScope:'Bot-authored verified task receipts (not owner-rated learning)'},
].map(entry=>Object.freeze({...entry,authority:'read-only',readiness:'implemented',
  environments:Object.freeze(['local','cloud']),
  proof:Object.freeze(['test/runtime.test.mjs','test/cloud.test.mjs','test/capabilities.test.mjs']),
})));

export function commandsFor(environment){
  if(!['local','cloud','browser'].includes(environment))throw Error('Unknown execution environment');
  return Object.freeze(CAPABILITIES.filter(x=>x.environments.includes(environment)).map(x=>x.command));
}

export function capabilityManifest(environment){
  const commands=commandsFor(environment);
  return {schema:CAPABILITY_SCHEMA,environment,liveReadiness:'not-probed',
    capabilities:CAPABILITIES.filter(x=>commands.includes(x.command)).map(x=>({
      id:x.id,command:x.command,description:x.description,authority:x.authority,
      readiness:x.readiness,scope:environment==='local'?x.localScope:x.cloudScope,proof:[...x.proof],
    }))};
}
