/**
 * Restrict Council governance PR repairs to reversible, source/test-only edits.
 * This module does NOT grant GitHub writes. The caller separately verifies an
 * authenticated primary-owner command against the live comment and PR head.
 * Actual patching still requires exact-context CAS and current-main ancestry.
 */
const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const SHA=/^[a-f0-9]{40}$/;
const BRANCH=/^governance\/council-[a-z0-9][a-z0-9-]{2,62}$/;
export const COUNCIL_REPAIR_MARKER='<!-- ULTRON_COUNCIL_REPAIR_PR_V1 -->';

const SOURCE_TO_TEST=Object.freeze({
 'src/council-members.mjs':'test/council-members.test.mjs',
 'src/council-run-provenance.mjs':'test/council-run-provenance.test.mjs',
 'src/council-owner-delegation.mjs':'test/council-owner-delegation.test.mjs'
});
const ELIGIBLE=new Set([
 ...Object.keys(SOURCE_TO_TEST),...Object.values(SOURCE_TO_TEST),
 'docs/COUNCIL-7OF7-ENFORCEMENT.md'
]);
function canonical(repo){
 return repo?.full_name===REPO&&repo?.id===REPO_ID;
}
export function isCouncilGovernanceRepairPr(pr){
 return Number.isSafeInteger(pr?.number)&&pr.number>0&&pr.state==='open'&&
  typeof pr.body==='string'&&pr.body.includes(COUNCIL_REPAIR_MARKER)&&
  BRANCH.test(pr.head?.ref||'')&&
  SHA.test(pr.head?.sha||'')&&SHA.test(pr.base?.sha||'')&&
  canonical(pr.head?.repo)&&canonical(pr.base?.repo)&&
  pr.base.ref==='main';
}
export function assertCouncilRepairPaths(pr,rawPaths){
 if(!isCouncilGovernanceRepairPr(pr))
  throw Error('Council governance repair admission denied');
 if(!Array.isArray(rawPaths)||rawPaths.length<1||rawPaths.length>4)
  throw Error('Council repair changes out of scope');
 const paths=new Set();
 for(const path of rawPaths){
  if(typeof path!=='string'||!ELIGIBLE.has(path)||paths.has(path))
   throw Error('Council repair path or duplicate change denied');
  paths.add(path);
 }
 for(const [source,test] of Object.entries(SOURCE_TO_TEST)){
  if(paths.has(source)&&!paths.has(test))
   throw Error('Council source repair requires paired regression: '+test);
 }
 return true;
}
export function assertCouncilRepairManifest(pr,patch){
 const changes=patch?.changes;
 if(!Array.isArray(changes))
  throw Error('Council repair changes out of scope');
 assertCouncilRepairPaths(pr,changes.map(change=>change?.path));
 for(const change of changes){
  if(typeof change?.before!=='string'||typeof change?.after!=='string'||
     !change.before||!change.after||change.before===change.after)
   throw Error('Council repair source context invalid');
 }
 return true;
}
