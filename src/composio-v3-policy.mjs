/** Pure policy boundary for Composio v3. No credentials, provider requests or model inference. */
export const COMPOSIO_OWNER = Object.freeze({
  repository: 'michaeljwilliams0123/Ultron.MW', repositoryId: 1424939667,
  owner: Object.freeze({ alias:'mw-primary', login:'michaeljwilliams0123', id:308995719 }),
  executor: Object.freeze({ alias:'ultron-admin', login:'michaeljwilliams0123ultron', id:354634860 }),
});
export const COMPOSIO_READ_TOOLS = Object.freeze([
  'GITHUB_GET_THE_AUTHENTICATED_USER', 'GITHUB_GET_A_REPOSITORY',
]);
export const COMPOSIO_TOOL_CAP = 1000;
const CA = /^ca_[A-Za-z0-9_-]{3,120}$/;
const AC = /^ac_[A-Za-z0-9_-]{3,120}$/;
const deny = message => { throw Error('Composio v3 admission denied: '+message); };
export const validComposioAccountId = value => typeof value==='string' && CA.test(value);

function validateBase({primaryAccountId,executorAccountId,customAuthConfigId,profile}={}){
 if(!validComposioAccountId(primaryAccountId))deny('primary account must be a verified Platform connection');
 if(!['primary-direct','multi-account','primary-proxy'].includes(profile))deny('unsupported session profile');
 if(profile==='multi-account'){
  if(!validComposioAccountId(executorAccountId)||executorAccountId===primaryAccountId)
   deny('separate executor Platform connection required');
  if(typeof customAuthConfigId!=='string'||!AC.test(customAuthConfigId))
   deny('verified custom GitHub Auth Config ID required');
 }
 if(customAuthConfigId!==undefined && (!AC.test(customAuthConfigId)))deny('invalid auth config');
}
export function buildComposioV3Policy({
 profile='primary-direct',primaryAccountId,executorAccountId,customAuthConfigId,
 sessionPresetDirectTools,
}={}){
 validateBase({profile,primaryAccountId,executorAccountId,customAuthConfigId});
 // Never offer more than the explicit two-tool allowlist; never enable paid Instant.
 if(COMPOSIO_READ_TOOLS.length>COMPOSIO_TOOL_CAP)deny('tool cap exceeded');
 const options={
  toolkits:['github'],
  tools:{github:{enable:[...COMPOSIO_READ_TOOLS]}},
  instant:false,
  sandbox:{enable:false,enableProxyExecution:false},
  manageConnections:{enable:false},
  proxyExecute:false,
  connectedAccounts:{github:profile==='multi-account'?
    [primaryAccountId,executorAccountId]:[primaryAccountId]},
 };
 if(customAuthConfigId)options.authConfigs={github:customAuthConfigId};
 if(profile==='multi-account'){
  // DIRECT_TOOLS preloads tools, which Composio does not support with multi-account.
  options.multiAccount={enable:true,maxAccountsPerToolkit:3,requireExplicitSelection:true};
 }else{
  if(sessionPresetDirectTools===undefined)deny('trusted SDK SessionPreset.DIRECT_TOOLS required');
  options.sessionPreset=sessionPresetDirectTools;
  options.multiAccount={enable:false};
 }
 if(profile==='primary-proxy'){
  // Dedicated owner-only proxy session. API client must NEVER be handed to agents.
  options.proxyExecute=true;
 }
 return Object.freeze(options);
}
export function requireComposioReadAdmission({actor,toolSlug,accountIds,grantVerified=false}={}){
 if(!COMPOSIO_READ_TOOLS.includes(toolSlug))deny('only read-only GitHub tools are enabled');
 if(actor!=='mw-primary'&&actor!=='ultron-admin')deny('explicit actor required');
 const account=actor==='mw-primary'?accountIds?.primaryAccountId:accountIds?.executorAccountId;
 if(!validComposioAccountId(account))deny('unverified Platform connected account');
 if(actor==='ultron-admin'&&grantVerified!==true)
  deny('signed-grant verification required for delegated actor');
 return Object.freeze({actor,account,toolSlug,effect:'read'});
}
export function requireComposioProxyRead({profile,actor,method,endpoint}={}){
 if(profile!=='primary-proxy'||actor!=='mw-primary'||method!=='GET')
  deny('raw GitHub proxy is primary-only GET');
 if(typeof endpoint!=='string'||!/^(\/user|\/repos\/michaeljwilliams0123\/Ultron\.MW(?:\/git\/ref\/heads\/main)?)$/.test(endpoint))
  deny('raw GitHub proxy endpoint denied');
 return Object.freeze({toolkit:'github',endpoint,method:'GET'});
}
export function maskComposioDisplay(value){
 if(typeof value!=='string'||!value)return '****';
 return value.slice(0,4)+'••••';
}
export function denyUntrustedComposioMutation(){
 deny('GitHub mutations must use existing signed owner/Council, App token and durable ledger executor');
}
