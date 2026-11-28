// Account-wide provider measurements are distinct from conservative reservations.
export const TARGET_BYTES=400_000_000, LIMIT_BYTES=500_000_000;
const RESERVATION_BYTES=2_000_000, DAILY_CHECKS=24;
export type BandwidthState={day:string;providerBytes:number|null;estimatedBytes:number;checks:number;lastAdmittedAt:number|null;quotaHold:boolean};
export type BandwidthAction={kind:'admit'|'status'}|{kind:'quota-hold';day:string}|{kind:'observe';day:string;bytes:number};
export function applyBandwidthAction(previous:BandwidthState|null|undefined,action:BandwidthAction,now=Date.now()){
 const day=new Date(now).toISOString().slice(0,10);
 const s:BandwidthState=previous?.day===day?{...previous}:{day,providerBytes:null,estimatedBytes:0,checks:0,lastAdmittedAt:null,quotaHold:false};
 let allowed=false,accepted=true,reason='status';
 if(action.kind==='observe'){
  if(action.day!==day||!Number.isSafeInteger(action.bytes)||action.bytes<0||action.bytes<(s.providerBytes??0)){
   accepted=false;reason='invalid-or-stale-provider-observation';
  }else{
   s.providerBytes=action.bytes;
   s.estimatedBytes=Math.max(s.estimatedBytes,action.bytes);
   if(action.bytes>=LIMIT_BYTES)s.quotaHold=true;
   reason='provider-observed';
  }
 }else if(action.kind==='quota-hold'){
  if(action.day!==day){accepted=false;reason='invalid-or-stale-quota-hold';}else{s.quotaHold=true;reason='provider-quota-hold';}
 }else if(action.kind==='admit'){
  const pace=s.estimatedBytes>=375_000_000?3600_000:s.estimatedBytes>=300_000_000?1800_000:600_000;
  if(s.quotaHold)reason='provider-quota-hold';
  else if(s.estimatedBytes+RESERVATION_BYTES>TARGET_BYTES)reason='conservation-threshold';
  else if(s.checks>=DAILY_CHECKS)reason='daily-verification-limit';
  else if(s.lastAdmittedAt!==null&&now-s.lastAdmittedAt<pace)reason='paced';
  else{allowed=true;reason='admitted';s.estimatedBytes+=RESERVATION_BYTES;s.checks++;s.lastAdmittedAt=now;}
 }
 return {state:s,result:{...s,allowed,accepted,reason,targetBytes:TARGET_BYTES,reserveBytes:LIMIT_BYTES-TARGET_BYTES,limitBytes:LIMIT_BYTES,measurement:s.providerBytes===null?'estimate-only':'provider-sample-plus-reservations',resetAt:new Date(Date.parse(day+'T00:00:00Z')+86400_000).toISOString()}};
}
