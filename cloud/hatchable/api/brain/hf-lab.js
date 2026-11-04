import {db} from 'hatchable';
import {getHfLabView} from 'lib/hf-lab-view.js';
export const access='admin';
export const methods=['GET'];
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 try{
  return res.json(await getHfLabView({db}));
 }catch{
  return res.status(503).json({schema:'ultron.hf-lab.v1',
   error:'hf-lab-observation-unavailable'});
 }
}
