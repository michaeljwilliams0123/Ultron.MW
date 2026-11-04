import {events} from 'hatchable';
// The platform owns token expiration, subscription replay and transport.
// Never allow the public status surface to grant private data channels.
export const access='admin';
export const methods=['GET'];
export default async function(req,res){
 if(req.member?.handle!=='michaeljwilliams0123')
  return res.status(403).json({error:'owner-required'});
 res.setHeader('Cache-Control','private, no-store');
 try{return res.json(await events.grant(['ultron.owner']));}
 catch{return res.status(503).json({error:'live-subscription-unavailable'});}
}
