import type {Env} from './lib';
import type {BandwidthAction,applyBandwidthAction} from './bandwidth-policy';
export async function bandwidthCommand(env:Env,action:BandwidthAction):Promise<ReturnType<typeof applyBandwidthAction>['result']>{
 if(!env.RATE_LIMITER)throw Error('bandwidth-governor-unavailable');
 const stub=env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName('hatchable-bandwidth-v1'));
 const r=await stub.fetch('https://internal/bandwidth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(action)});
 if(!r.ok)throw Error('bandwidth-governor-unavailable');
 return await r.json() as ReturnType<typeof applyBandwidthAction>['result'];
}
