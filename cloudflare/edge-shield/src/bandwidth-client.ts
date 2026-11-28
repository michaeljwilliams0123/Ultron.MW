import type { Env } from './lib';
import type {
  BandwidthAction,
  BandwidthPathClass,
  applyBandwidthAction,
} from './bandwidth-policy';

export type BandwidthResult = ReturnType<typeof applyBandwidthAction>['result'];

export async function bandwidthCommand(
  env: Env,
  action: BandwidthAction,
): Promise<BandwidthResult> {
  if (!env.RATE_LIMITER) throw Error('bandwidth-governor-unavailable');
  const stub = env.RATE_LIMITER.get(
    env.RATE_LIMITER.idFromName('hatchable-bandwidth-v1'),
  );
  const r = await stub.fetch('https://internal/bandwidth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(action),
  });
  if (!r.ok) throw Error('bandwidth-governor-unavailable');
  return (await r.json()) as BandwidthResult;
}

export function reserveBandwidth(
  env: Env,
  opts: {
    reservationId: string;
    bytes?: number;
    pathClass?: BandwidthPathClass;
  },
): Promise<BandwidthResult> {
  return bandwidthCommand(env, { kind: 'reserve', ...opts });
}

export function reconcileBandwidth(
  env: Env,
  opts: {
    reservationId: string;
    actualBytes: number;
    day?: string;
    failed?: boolean;
  },
): Promise<BandwidthResult> {
  return bandwidthCommand(env, { kind: 'reconcile', ...opts });
}
