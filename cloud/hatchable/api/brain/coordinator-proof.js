// Owner-only: historical Coordinator identity, workflow, and main lineage proof.
import {api} from 'hatchable';
import {verifyHistoricalCoordinatorProof} from 'lib/coordinator-historical-proof.js';
export const access='admin';
export const methods=['GET'];
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Vary','Cookie');
 if(req.member?.handle!=='michaeljwilliams0123')
  return res.status(403).json({error:'owner-identity-required'});
 return res.status(200).json(await verifyHistoricalCoordinatorProof(
  (name,options)=>api.call(name,options)
 ));
}
