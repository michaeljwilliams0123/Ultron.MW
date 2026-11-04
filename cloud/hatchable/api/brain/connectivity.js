import {db} from 'hatchable';
import {collectConnectivity} from 'lib/connectivity-view.js';

// Owner-only status. GitHub is sampled through read-only public API requests;
// mutable operational state is read from the durable Hatchable ledger.
export const access='admin';
export const methods=['GET'];
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 try {
  const result=await collectConnectivity({db});
  return res.json(result);
 }catch{
  return res.status(503).json({schema:'ultron.connectivity.v1',ok:false,
   error:'connection-observation-unavailable'});
 }
}
