import {db,config} from 'hatchable';
import {verifyMahoragaIssueReadback} from 'lib/mahoraga-actions.js';

/* Read-only, owner-bound verification against GitHub itself.
 * A local adapter "observed" row is not sufficient proof by itself. */
export const access='admin';
export const methods=['GET'];
export default async function(req,res){
 if(req.member?.handle!=='michaeljwilliams0123')
  return res.status(403).json({ok:false,status:'held',
   reason:'owner-identity-required',productionAccepted:false});
 const result=await verifyMahoragaIssueReadback({db,config},req.query?.key);
 const status=result.status==='verified'?200:
  result.status==='reconcile-required'?503:
  result.reason==='provider-action-not-observed'?404:
  result.reason==='invalid-provider-readback-request'?400:409;
 return res.status(status).json(result);
}
