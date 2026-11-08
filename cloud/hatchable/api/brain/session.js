// Owner session and realtime capability are independent. Do not infer
// authentication from the optional events channel or from browser storage.
export const access='admin';
export const methods=['GET'];
const OWNER='michaeljwilliams0123';
export default function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Vary','Cookie');
 if(req.member?.handle!==OWNER)
  return res.status(403).json({schema:'ultron.owner-session.v1',
   authenticated:false,reason:'owner-identity-required'});
 return res.json({schema:'ultron.owner-session.v1',
  authenticated:true,owner:OWNER});
}
