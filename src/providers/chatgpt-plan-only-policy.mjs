/**
 * Defense-in-depth against accidental ChatGPT app credit consumption.
 *
 * This checks a recent OWNER acknowledgement of visible Settings > Usage.
 * It cannot inspect or change OpenAI's server-side spending preference.
 * Only the app limit <100%, configured in OpenAI's settings, is the actual
 * account-enforced no-credit safeguard.
 */
const HOUR=60*60*1000;
export function assertOwnerConfirmedPlanOnly(credential,confirmation,{now=Date.now()}={}){
 const fail=()=>{throw Error('chatgpt-plan-only-settings-not-confirmed')};
 if(!credential||credential.kind!=='chatgpt-plan-oauth'||
    !confirmation||confirmation.kind!=='owner-confirmed-plan-only-settings'||
    confirmation.clientId!==credential.client_id||
    confirmation.hostId!==credential.ext_agent_host_id||
    confirmation.subject!==credential.subject||
    !Number.isInteger(confirmation.appLimitPercent)||
    confirmation.appLimitPercent<1||confirmation.appLimitPercent>=100||
    confirmation.appCreditsEnabled!==false)
   fail();
 const at=Date.parse(confirmation.confirmedAt??'');
 if(!Number.isFinite(at)||!Number.isFinite(now)||
    at>now+5*60*1000||now-at>24*HOUR)fail();
 return true;
}
