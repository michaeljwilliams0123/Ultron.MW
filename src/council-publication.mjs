/** Stable evidence receipts for deterministic Council roles.
 * An individual role is NOT a separate GitHub identity, authenticated worker,
 * model invocation, or independent reviewer until separately provisioned.
 */
import {createHash} from 'node:crypto';
export const COUNCIL_ROLES=Object.freeze([
  'ultron-builder','ultron-skeptic','ultron-steward','ultron-predictor',
  'ultron-generator','ultron-sentinel','ultron-companion'
]);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const strings=value=>Array.isArray(value)?
  [...new Set(value.filter(v=>typeof v==='string'&&v.length<=300))].sort():[];

export function buildCouncilPublication({
  title,body,isPr,sourceSha='',positions,ownerMode=false,flags={}
}={}){
  if(typeof title!=='string'||!title.trim()||typeof body!=='string'||
    typeof isPr!=='boolean'||typeof ownerMode!=='boolean'||
    typeof sourceSha!=='string'||(sourceSha!==''&&!/^[a-f0-9]{40}$/.test(sourceSha))||
    !Array.isArray(positions)||positions.length!==COUNCIL_ROLES.length)
    throw Error('council-publication-input-invalid');
  const byRole=new Map();
  for(const p of positions){
    if(!p||!COUNCIL_ROLES.includes(p.individualId)||byRole.has(p.individualId)||
      !['proceed','hold'].includes(p.conclusion)||
      typeof p.confidence!=='number'||p.confidence<0||p.confidence>1||
      !Number.isFinite(p.confidence))
      throw Error('council-publication-position-invalid');
    byRole.set(p.individualId,p);
  }
  const context=Object.freeze({
    schema:'ultron.council-publication.v2',title,body,isPr,sourceSha,ownerMode,
    flags:Object.fromEntries(Object.entries(flags).sort(([a],[b])=>a.localeCompare(b))
      .filter(([,v])=>typeof v==='boolean'))
  });
  const contextSha=hash(context);
  const members=COUNCIL_ROLES.map(roleId=>{
    const p=byRole.get(roleId);
    const assessment={
      roleId,conclusion:p.conclusion,confidence:p.confidence,
      evidenceRefs:strings(p.evidenceRefs),
      unknowns:strings(p.unknowns),dissentTags:strings(p.dissentTags),
      identityStatus:'unbound',githubPrincipal:null,modelBacked:false
    };
    return Object.freeze({...assessment,fingerprint:hash({
      contextSha,assessment,algorithm:'deterministic-role-v2'
    })});
  });
  const fingerprint=hash({contextSha,
    members:members.map(m=>m.fingerprint),version:'council-evidence-v2'});
  return Object.freeze({fingerprint,
    marker:'<!-- ultron-council-evidence-v2:'+fingerprint+' -->',
    members:Object.freeze(members)});
}
export function alreadyPublished(publication,comments){
  if(!publication||typeof publication.marker!=='string'||!Array.isArray(comments))
    throw Error('council-publication-history-invalid');
  return comments.some(c=>c?.user?.login==='github-actions[bot]'&&
    typeof c.body==='string'&&c.body.startsWith('# Ultron Council Report')&&
    c.body.includes(publication.marker));
}
