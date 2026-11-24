import {db,config,api} from 'hatchable';
import {readCanonicalReleaseProof} from 'lib/release-proof-readback.js';
import {authorizeEdgeReleaseReadback,projectEdgeReleaseProof} from 'lib/release-proof-edge-auth.js';
export const access='public';
export const methods=['GET'];
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'method-not-allowed'});
 let secret;try{secret=await config.get('ORIGIN_LOCK_SECRET');}catch{}
 if(!await authorizeEdgeReleaseReadback({headers:req.headers,secret,method:req.method}))
  return res.status(403).json({error:'edge-readback-denied'});
 try{return res.json(projectEdgeReleaseProof(await readCanonicalReleaseProof({db,config,api})));}
 catch{return res.status(503).json({error:'edge-readback-unavailable'});}
}
