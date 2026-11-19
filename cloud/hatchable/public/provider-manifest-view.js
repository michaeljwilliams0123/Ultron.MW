// Presentation-only model: never interpret connection evidence as an owner grant.
const IDS=Object.freeze([
 'github','gitlab','destiny','mahoraga','reef','research','openapi','browser'
]);
function denied(){
 return {ok:false,total:0,connected:0,blocked:0,executionAuthorized:0,rows:[]};
}
function text(value){
 return typeof value==='string'?value.slice(0,180):'Unverified';
}
export function providerVisibilityModel(bundle){
 if(!bundle||bundle.schema!=='ultron.provider-manifests.v1'||
    bundle.manifestVersion!==1||bundle.readOnly!==true||
    bundle.paidCeilingCents!==0||bundle.executionAuthorized!==false||
    !Array.isArray(bundle.manifests)||bundle.manifests.length!==IDS.length)
  return denied();
 const seen=new Set();
 const rows=[];
 for(const m of bundle.manifests){
  if(!m||!IDS.includes(m.id)||seen.has(m.id)||m.version!==1||
     !['connected','blocked'].includes(m.state)||
     (m.state==='connected'&&m.connected!==true)||
     (m.state==='blocked'&&m.connected!==false&&m.connected!==null)||
     m.ready!==false||m.executionAuthorized!==false||m.paidCeilingCents!==0||
     !Array.isArray(m.operations)||!Array.isArray(m.blockers)||
     m.operations.some(x=>typeof x!=='string')||
     m.blockers.some(x=>typeof x!=='string')||
     !m.visibilityEvidence||m.visibilityEvidence.scopeEnforcement!=='unverified'||
     m.visibilityEvidence.schemaVerified!==false||
     m.visibilityEvidence.health!=='not-measured'||
     m.visibilityEvidence.latencyMs!==null||
     m.visibilityEvidence.quota!=='unknown'||
     m.visibilityEvidence.canary!=='not-observed'||
     m.visibilityEvidence.rollback!=='not-observed'||
     m.visibilityEvidence.lastProbeAt!==null||
     !m.lifecycleEvidence||
     m.lifecycleEvidence.disable!=='not-observed'||
     m.lifecycleEvidence.revoke!=='not-observed'||
     m.lifecycleEvidence.rollback!=='not-observed')
   return denied();
  seen.add(m.id);
  const connected=m.state==='connected';
  const evidence=m.visibilityEvidence;
  if(evidence.identityVerified!==true&&evidence.identityVerified!==false)
   return denied();
  if((evidence.identityVerified===true&&typeof evidence.identity!=='string')||
     (evidence.identityVerified===false&&evidence.identity!==null))
   return denied();
  const identity=evidence.identityVerified?text(evidence.identity):'Unverified';
  const op=m.operations.length?m.operations.map(text).join(', '):'none declared';
  const detail=[
   'ID: '+text(m.id)+' · Version: '+m.version,
   'Identity: '+identity+' · Read evidence: '+text(m.connectionEvidence),
   'Scope: '+text(m.scope)+' (enforcement unverified)',
   'Operation: '+op+' ('+text(evidence.operationContract)+')',
   'Health: '+text(evidence.health)+' · Latency: unmeasured · Quota: unknown',
   'Schema: unverified · Canary: '+text(evidence.canary)+' · Last probe: unrecorded',
   'Lifecycle: disable/revoke/rollback not observed',
   'Blockers: '+(m.blockers.length?m.blockers.map(text).join(', '):'none declared')
  ].join(' | ');
  rows.push({id:m.id,name:text(m.name),connected,
   connection:connected?'Connected (read observation)':'Blocked / unverified',
   authority:'Not authorized',identity,details:detail});
 }
 if(seen.size!==IDS.length)return denied();
 rows.sort((a,b)=>IDS.indexOf(a.id)-IDS.indexOf(b.id));
 const connected=rows.filter(x=>x.connected).length;
 return {ok:true,total:IDS.length,connected,blocked:IDS.length-connected,
  executionAuthorized:0,rows};
}
