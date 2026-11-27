import {applyBandwidthAction} from '../bandwidth-policy';
import type {BandwidthAction,BandwidthState} from '../bandwidth-policy';

export class RateLimiter implements DurableObject {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if(new URL(request.url).pathname==='/bandwidth'){
      if(request.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405});
      const a=await request.json().catch(()=>null) as BandwidthAction|null;
      if(!a||!['admit','status','quota-hold','observe'].includes(a.kind))return Response.json({error:'invalid_action'},{status:400});
      const result=await this.state.storage.transaction(async txn=>{
        const old=await txn.get<BandwidthState>('bandwidth:v1');
        const next=applyBandwidthAction(old,a);
        if(a.kind!=='status')await txn.put('bandwidth:v1',next.state);
        return next.result;
      });
      return Response.json(result);
    }
    const { limit, windowMs } = (await request.json()) as {
      limit: number;
      windowMs: number;
    };
    const now = Date.now();
    const window = Math.floor(now / windowMs);
    const key = `w:${window}`;
    const count = ((await this.state.storage.get<number>(key)) ?? 0) + 1;
    await this.state.storage.put(key, count);
    if (count === 1) {
      const stale = await this.state.storage.list({ prefix: "w:" });
      for (const k of stale.keys()) {
        if (k !== key) await this.state.storage.delete(k);
      }
    }
    const resetAt = (window + 1) * windowMs;
    return Response.json({
      allowed: count <= limit,
      count,
      limit,
      retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    });
  }
}
