// Owner-only, read-only Cloudflare staging health. No API tokens, secrets,
// queue writes or GitHub actions are permitted through this route.
export const access = 'admin';
export const methods = ['GET'];
const OWNER = 'michaeljwilliams0123';
const EDGE = 'https://ultron-mw-edge-staging.mahoraga-mjw0123.workers.dev/healthz';
const SCHEMA = 'ultron.cloudflare-edge-health.v1';
export default async function(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if(req.member?.handle!==OWNER)
    return res.status(403).json({schema:SCHEMA,error:'owner-identity-required'});
  try {
    const response=await fetch(EDGE,{
      method:'GET',
      headers:{Accept:'application/json'},
      redirect:'error',
      signal:AbortSignal.timeout(4000)
    });
    if(!response.ok)
      return res.status(503).json({schema:SCHEMA,state:'unavailable',executionAuthorized:false});
    const data=await response.json();
    if(data?.service!=='uuam-edge-staging'||data?.status!=='available'||
       typeof data.accepting!=='boolean')
      return res.status(502).json({schema:SCHEMA,state:'invalid-readback',executionAuthorized:false});
    return res.json({
      schema:SCHEMA,
      state:'observed',
      service:'uuam-edge-staging',
      ingressAccepting:data.accepting,
      executionAuthorized:false,
      environment:'staging',
      note:'Edge admission does not grant a GitHub write. Owner/Council checks remain in Hatchable.'
    });
  }catch{
    return res.status(503).json({schema:SCHEMA,state:'unavailable',executionAuthorized:false});
  }
}
