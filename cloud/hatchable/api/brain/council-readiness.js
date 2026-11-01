// Owner-only, read-only wiring verification for the canonical Hatchable brain.
// Never claims installed identities or authenticated live Council workers.
import {db} from 'hatchable';
import {assessCouncilWiring} from 'lib/council-wiring.js';
export const access='admin';
export const methods=['GET'];
export default async function(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  const observed=await db.query(
   "SELECT table_name FROM information_schema.tables "+
   "WHERE table_schema=current_schema() AND table_type='BASE TABLE'"
  );
  if(!Array.isArray(observed?.rows)||
     observed.rows.some(row=>typeof row?.table_name!=='string'))
   throw Error('schema-readback-invalid');
  const readiness=assessCouncilWiring({
   tables:observed.rows.map(row=>row.table_name),
   // No installation metadata is available from the current bridge.
   // Never infer seven App identities from an owner PAT or a manifest.
   installationObservations:[]
  });
  return res.status(200).json({
   ...readiness,observedAt:new Date().toISOString(),
   deploymentStatus:'source-candidate-not-production-accepted',
   identityEvidence:'not-observed',
   browserExecution:'not-configured',
   mahoragaPeerRead:'not-authorized-for-seven-apps'
  });
 }catch{
  return res.status(503).json({
   schema:'ultron.council.wiring-readiness.v1',readOnly:true,
   readyForProduction:false,error:'council-readiness-unavailable'
  });
 }
}
