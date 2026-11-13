#!/usr/bin/env node
/**
 * Phase 7 read-only canary against an already persisted Platform session.
 * Deliberately NEVER creates sessions, writes GitHub, or logs account IDs.
 * A ChatGPT-hosted connection does not substitute for these Platform secrets.
 */
import {Composio} from '@composio/core';
import {createHash} from 'node:crypto';
const required=['ULTRON_COMPOSIO_API_KEY','ULTRON_COMPOSIO_SESSION_ID',
 'ULTRON_COMPOSIO_GITHUB_PRIMARY_ACCOUNT_ID'];
const missing=required.filter(name=>typeof process.env[name]!=='string'||
  process.env[name].trim().length===0);
if(process.argv.includes('--dry-run')){
 console.log(JSON.stringify({schema:'ultron.composio.canary.v1',mode:'dry-run',
  externalCalls:0,missingConfiguration:missing,paidCeilingCents:0}));
 process.exit(0);
}
if(missing.length){
 console.error(JSON.stringify({status:'not-executed',reason:'Platform-configuration-missing',
  keysMissing:missing}));
 process.exit(2);
}
const deny=reason=>{throw Error('Composio live canary failed: '+reason);};
try{
 const client=new Composio({apiKey:process.env.ULTRON_COMPOSIO_API_KEY});
 const session=await client.use(process.env.ULTRON_COMPOSIO_SESSION_ID);
 const config=session?.config, account=process.env.ULTRON_COMPOSIO_GITHUB_PRIMARY_ACCOUNT_ID;
 if(config?.instant!==false)deny('paid usage not explicitly disabled');
 const users=config.connected_accounts?.github||config.connectedAccounts?.github;
 if(!Array.isArray(users)||users.length!==1||users[0]!==account)
  deny('default session is not owner-only pinned');
 const result=await session.execute('GITHUB_GET_THE_AUTHENTICATED_USER',{},{
  account});
 if(result?.resultType!=='completed')deny('user read not completed');
 const profile=result.data?.successful===true?result.data.data:result.data;
 if(profile?.login!=='michaeljwilliams0123'||Number(profile?.id)!==308995719)
  deny('default owner identity mismatch');
 const repo=await session.execute('GITHUB_GET_A_REPOSITORY',{
  owner:'michaeljwilliams0123',repo:'Ultron.MW'},{account});
 if(repo?.resultType!=='completed')deny('repository read not completed');
 const data=repo.data?.successful===true?repo.data.data:repo.data;
 if(data?.full_name!=='michaeljwilliams0123/Ultron.MW'||
    Number(data?.id)!==1424939667||
    Number(data?.owner?.id)!==308995719)
  deny('canonical repository mismatch');
 const digest=createHash('sha256').update(JSON.stringify({
   owner:profile.login,id:Number(profile.id),repository:data.full_name,
   repositoryId:Number(data.id)})).digest('hex');
 console.log(JSON.stringify({schema:'ultron.composio.canary.v1',mode:'live',
  result:'read-only-observed',actor:'mw-primary',githubUserId:308995719,
  repositoryId:1424939667,observationDigest:digest,paidCeilingCents:0,
  // This process does not perform independent Hatchable/Postgres readback.
  productionAccepted:false}));
}catch{
 console.error(JSON.stringify({result:'held',reason:'Platform-session-readback-unverified'}));
 process.exit(1);
}
