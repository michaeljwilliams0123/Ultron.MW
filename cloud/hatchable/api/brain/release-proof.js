import {db,config,api} from 'hatchable';
import {readCanonicalReleaseProof} from 'lib/release-proof-readback.js';
export const access='admin';
export const methods=['GET'];
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 return res.json(await readCanonicalReleaseProof({db,config,api}));
}
