import {db,config,api} from 'hatchable';
import {readCanonicalReleaseProof} from 'lib/release-proof-readback.js';
import {authorizeEdgeReleaseReadback,projectEdgeReleaseProof} from 'lib/release-proof-edge-auth.js';
export const access='public';
export const methods=['GET'];
async function consumeDurableNonce(nonce,tsSec){
 if(typeof db?.query!=='function')return true;
 const res=await db.query(
  `INSERT INTO brain_github_approval_nonces(nonce,operation,target_resource,approval_timestamp,expires_at)
   VALUES($1,'edge-release-proof-read','/api/brain/release-proof-edge',to_timestamp($2),to_timestamp($2 + 120))
   ON CONFLICT(nonce) DO NOTHING RETURNING nonce`,
  ['edge-proof:'+nonce,tsSec]);
 return Array.isArray(res?.rows)&&res.rows.length===1;
}
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'method-not-allowed'});
 let secret;try{secret=await config.get('ORIGIN_LOCK_SECRET');}catch{}
 if(!await authorizeEdgeReleaseReadback({headers:req.headers,secret,method:req.method,consumeNonce:consumeDurableNonce}))
  return res.status(403).json({error:'edge-readback-denied'});
 try{return res.json(projectEdgeReleaseProof(await readCanonicalReleaseProof({db,config,api})));}
 catch{return res.status(503).json({error:'edge-readback-unavailable'});}
}
