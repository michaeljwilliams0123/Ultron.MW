/**
 * Read-only owner readiness for external Composio Node worker.
 * No credentials or account state values ever serialized to clients.
 */
import {config,db} from 'hatchable';
export const access='admin';
export const methods=['GET'];
const OWNER='michaeljwilliams0123';
const KEYS=['ULTRON_COMPOSIO_API_KEY',
 'ULTRON_COMPOSIO_GITHUB_PRIMARY_ACCOUNT_ID',
 'ULTRON_COMPOSIO_GITHUB_ADMIN_ACCOUNT_ID',
 'ULTRON_COMPOSIO_GITHUB_AUTH_CONFIG_ID'];
async function present(name){
 try{const value=await config.get(name);
  return typeof value==='string'&&value.trim().length>0;
 }catch{return false;}
}
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Vary','Cookie');
 if(req.member?.handle!==OWNER)return res.status(403).json({
  schema:'ultron.composio-v3.readiness.v1',error:'owner-identity-required'});
 const values=await Promise.all(KEYS.map(present));
 const configurationPresent=Object.fromEntries(KEYS.map((k,i)=>[k,values[i]]));
 let migration='unverified',principals=[];
 try{
  const result=await db.query(
   'SELECT principal_key,connection_state FROM brain_composio_principals ORDER BY principal_key');
  if(Array.isArray(result?.rows)){
   migration='present';
   principals=result.rows.map(row=>({
    alias:row.principal_key,
    state:row.connection_state==='active'?'configured-unverified':row.connection_state
   }));
  }
 }catch{migration='missing-or-unavailable';}
 return res.json({
  schema:'ultron.composio-v3.readiness.v1',ownerAuthenticated:true,
  policy:'github-read-only-until-signed-app-execution',
  migration,principals,configurationPresent,
  signedGrantVerified:false,sessionReadbackVerified:false,
  productionAccepted:false,paidCeilingCents:0
 });
}
