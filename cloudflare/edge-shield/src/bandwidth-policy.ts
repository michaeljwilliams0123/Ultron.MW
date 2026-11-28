// Account-wide provider measurements are distinct from conservative reservations.
export const TARGET_BYTES = 400_000_000;
export const WARN_BYTES = 350_000_000;
export const LIMIT_BYTES = 500_000_000;
export const DEFAULT_RESERVATION_BYTES = 2_000_000;
export const UNKNOWN_LENGTH_ESTIMATE_BYTES = 512_000;
export const MAX_CACHE_BUFFER_BYTES = 1_048_576;
const DAILY_CHECKS = 24;
export const RESERVATION_TTL_MS = 15 * 60_000;
const MAX_TRACKED_IDS = 4096;

export type BandwidthPathClass = 'discretionary' | 'workflow' | 'recovery';

export interface BandwidthReservation {
  bytes: number;
  pathClass: BandwidthPathClass;
  createdAt: number;
}

export type BandwidthState = {
  day: string;
  providerBytes: number | null;
  committedBytes?: number;
  reservedBytes?: number;
  estimatedBytes: number;
  checks: number;
  lastAdmittedAt: number | null;
  quotaHold: boolean;
  reservations?: Record<string, BandwidthReservation>;
  expiredReservations?: Record<string, number>;
  expiredIds?: string[];
  settledIds?: string[];
};

export type BandwidthAction =
  | { kind: 'admit' | 'status' }
  | { kind: 'quota-hold'; day: string }
  | { kind: 'observe'; day: string; bytes: number }
  | {
      kind: 'reserve';
      reservationId: string;
      bytes?: number;
      pathClass?: BandwidthPathClass;
    }
  | {
      kind: 'reconcile';
      reservationId: string;
      actualBytes: number;
      day?: string;
      failed?: boolean;
    };

function pushBounded(list: string[], id: string): string[] {
  const next = list.includes(id) ? list : [...list, id];
  return next.length > MAX_TRACKED_IDS ? next.slice(next.length - MAX_TRACKED_IDS) : next;
}

function recomputeEstimated(s: BandwidthState): number {
  const committed = s.committedBytes ?? s.estimatedBytes;
  const reserved = s.reservedBytes ?? 0;
  return Math.max(committed, s.providerBytes ?? 0) + reserved;
}

function pruneExpiredReservations(s: BandwidthState, now: number) {
  const reservations = s.reservations;
  if (!reservations) return;
  let expiredIds = s.expiredIds ?? [];
  const expiredReservations = s.expiredReservations ?? {};
  for (const [id, entry] of Object.entries(reservations)) {
    if (!entry || now - entry.createdAt > RESERVATION_TTL_MS) {
      // Preserve conservative reservedBytes until outcome/reconciliation or day rollover.
      if (entry && entry.bytes > 0 && expiredReservations[id] === undefined) {
        expiredReservations[id] = entry.bytes;
      }
      delete reservations[id];
      expiredIds = pushBounded(expiredIds, id);
    }
  }
  s.expiredReservations = expiredReservations;
  s.expiredIds = expiredIds;
}

export function applyBandwidthAction(
  previous: BandwidthState | null | undefined,
  action: BandwidthAction,
  now = Date.now(),
) {
  const day = new Date(now).toISOString().slice(0, 10);
  const s: BandwidthState =
    previous?.day === day
      ? {
          ...previous,
          committedBytes: previous.committedBytes ?? previous.estimatedBytes,
          reservedBytes: previous.reservedBytes ?? 0,
          reservations: previous.reservations ? { ...previous.reservations } : {},
          expiredReservations: previous.expiredReservations
            ? { ...previous.expiredReservations }
            : {},
          expiredIds: previous.expiredIds ? [...previous.expiredIds] : [],
          settledIds: previous.settledIds ? [...previous.settledIds] : [],
        }
      : {
          day,
          providerBytes: null,
          committedBytes: 0,
          reservedBytes: 0,
          estimatedBytes: 0,
          checks: 0,
          lastAdmittedAt: null,
          quotaHold: false,
          reservations: {},
          expiredReservations: {},
          expiredIds: [],
          settledIds: [],
        };

  pruneExpiredReservations(s, now);

  let allowed = false;
  let accepted = true;
  let reason = 'status';

  if (action.kind === 'observe') {
    if (
      action.day !== day ||
      !Number.isSafeInteger(action.bytes) ||
      action.bytes < 0 ||
      action.bytes < (s.providerBytes ?? 0)
    ) {
      accepted = false;
      reason = 'invalid-or-stale-provider-observation';
    } else {
      s.providerBytes = action.bytes;
      s.committedBytes = Math.max(s.committedBytes ?? 0, action.bytes);
      s.estimatedBytes = recomputeEstimated(s);
      if (action.bytes >= LIMIT_BYTES) s.quotaHold = true;
      reason = 'provider-observed';
    }
  } else if (action.kind === 'quota-hold') {
    if (action.day !== day) {
      accepted = false;
      reason = 'invalid-or-stale-quota-hold';
    } else {
      s.quotaHold = true;
      reason = 'provider-quota-hold';
    }
  } else if (action.kind === 'reserve') {
    const reqBytes =
      action.bytes === undefined ? UNKNOWN_LENGTH_ESTIMATE_BYTES : action.bytes;
    const pathClass: BandwidthPathClass = action.pathClass ?? 'discretionary';
    const ceiling = pathClass === 'recovery' ? LIMIT_BYTES : TARGET_BYTES;
    if (
      !action.reservationId ||
      !Number.isSafeInteger(reqBytes) ||
      reqBytes <= 0
    ) {
      accepted = false;
      reason = 'invalid-reservation-request';
    } else if (
      (s.reservations && s.reservations[action.reservationId]) ||
      (s.expiredReservations && s.expiredReservations[action.reservationId] !== undefined) ||
      s.settledIds?.includes(action.reservationId)
    ) {
      accepted = false;
      reason = 'duplicate-reservation';
    } else if (s.quotaHold) {
      reason = 'provider-quota-hold';
    } else if (s.estimatedBytes + reqBytes > ceiling) {
      reason =
        pathClass === 'recovery'
          ? 'provider-limit-ceiling'
          : 'conservation-threshold';
    } else {
      allowed = true;
      reason = 'reserved';
      s.reservations = s.reservations ?? {};
      s.reservations[action.reservationId] = {
        bytes: reqBytes,
        pathClass,
        createdAt: now,
      };
      s.reservedBytes = (s.reservedBytes ?? 0) + reqBytes;
      s.estimatedBytes = recomputeEstimated(s);
    }
  } else if (action.kind === 'reconcile') {
    if (
      !action.reservationId ||
      !Number.isSafeInteger(action.actualBytes) ||
      action.actualBytes < 0
    ) {
      accepted = false;
      reason = 'unknown-or-invalid-reconciliation';
    } else if (s.settledIds?.includes(action.reservationId)) {
      accepted = false;
      reason = 'already-reconciled';
    } else {
      const existing = s.reservations?.[action.reservationId];
      const expiredBytes = s.expiredReservations?.[action.reservationId];
      const wasExpired =
        expiredBytes !== undefined || (s.expiredIds?.includes(action.reservationId) ?? false);
      if (!existing && !wasExpired) {
        accepted = false;
        reason = 'unknown-or-invalid-reconciliation';
      } else if (action.day && action.day !== day) {
        if (existing) {
          delete s.reservations![action.reservationId];
          s.reservedBytes = Math.max(0, (s.reservedBytes ?? 0) - existing.bytes);
          s.estimatedBytes = recomputeEstimated(s);
        } else if (expiredBytes !== undefined) {
          delete s.expiredReservations![action.reservationId];
          s.reservedBytes = Math.max(0, (s.reservedBytes ?? 0) - expiredBytes);
          s.estimatedBytes = recomputeEstimated(s);
        }
        s.expiredIds = (s.expiredIds ?? []).filter((id) => id !== action.reservationId);
        s.settledIds = pushBounded(s.settledIds ?? [], action.reservationId);
        accepted = false;
        reason = 'stale-day-reservation-released';
      } else if (existing) {
        delete s.reservations![action.reservationId];
        s.reservedBytes = Math.max(0, (s.reservedBytes ?? 0) - existing.bytes);
        s.committedBytes = (s.committedBytes ?? 0) + action.actualBytes;
        s.estimatedBytes = recomputeEstimated(s);
        s.settledIds = pushBounded(s.settledIds ?? [], action.reservationId);
        allowed = true;
        reason = action.failed ? 'reconciled-failed' : 'reconciled';
      } else {
        if (expiredBytes !== undefined) {
          delete s.expiredReservations![action.reservationId];
          s.reservedBytes = Math.max(0, (s.reservedBytes ?? 0) - expiredBytes);
        }
        s.expiredIds = (s.expiredIds ?? []).filter((id) => id !== action.reservationId);
        s.committedBytes = (s.committedBytes ?? 0) + action.actualBytes;
        s.estimatedBytes = recomputeEstimated(s);
        s.settledIds = pushBounded(s.settledIds ?? [], action.reservationId);
        allowed = true;
        reason = 'late-reconciled';
      }
    }
  } else if (action.kind === 'admit') {
    const pace =
      s.estimatedBytes >= 375_000_000
        ? 3600_000
        : s.estimatedBytes >= 300_000_000
          ? 1800_000
          : 600_000;
    if (s.quotaHold) reason = 'provider-quota-hold';
    else if (s.estimatedBytes + DEFAULT_RESERVATION_BYTES > TARGET_BYTES)
      reason = 'conservation-threshold';
    else if (s.checks >= DAILY_CHECKS) reason = 'daily-verification-limit';
    else if (s.lastAdmittedAt !== null && now - s.lastAdmittedAt < pace)
      reason = 'paced';
    else {
      allowed = true;
      reason = 'admitted';
      s.committedBytes = (s.committedBytes ?? 0) + DEFAULT_RESERVATION_BYTES;
      s.estimatedBytes = recomputeEstimated(s);
      s.checks++;
      s.lastAdmittedAt = now;
    }
  }

  return {
    state: s,
    result: {
      day: s.day,
      providerBytes: s.providerBytes,
      committedBytes: s.committedBytes ?? 0,
      reservedBytes: s.reservedBytes ?? 0,
      estimatedBytes: s.estimatedBytes,
      checks: s.checks,
      lastAdmittedAt: s.lastAdmittedAt,
      quotaHold: s.quotaHold,
      allowed,
      accepted,
      reason,
      warning: s.estimatedBytes >= WARN_BYTES,
      warnBytes: WARN_BYTES,
      targetBytes: TARGET_BYTES,
      reserveBytes: LIMIT_BYTES - TARGET_BYTES,
      limitBytes: LIMIT_BYTES,
      activeReservations: Object.keys(s.reservations ?? {}).length,
      coverage: 'edge-observed-plus-provider-meter-excluding-direct-origin',
      measurement:
        s.providerBytes === null
          ? 'estimate-only'
          : 'provider-sample-plus-reservations',
      resetAt: new Date(
        Date.parse(day + 'T00:00:00Z') + 86400_000,
      ).toISOString(),
    },
  };
}

export function parseContentLength(headerVal: string | null): number | null {
  if (headerVal === null) return null;
  const trimmed = headerVal.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

const CACHEABLE_PATHS: RegExp[] = [
  /^\/api\/brain\/status-public$/,
  /^\/ultron-chat\.js$/,
  /^\/ultron-chat\.css$/,
  /^\/ultron-intent\.mjs$/,
  /^\/favicon\.(ico|svg)$/,
  /^\/assets\//,
  /^\/static\//,
];

const CACHE_BUST_PARAMS = new Set(['_', '_t', 't', 'ts', 'cb', 'cachebust', 'fbclid']);

export function normalizeCacheUrl(rawUrl: string): string {
  const u = new URL(rawUrl);
  for (const key of [...u.searchParams.keys()]) {
    if (CACHE_BUST_PARAMS.has(key) || key.startsWith('utm_')) {
      u.searchParams.delete(key);
    }
  }
  u.searchParams.sort();
  return u.toString();
}

export function isCacheableRequest(request: Request): boolean {
  if (request.method !== 'GET') return false;
  if (
    request.headers.has('Authorization') ||
    request.headers.has('Cookie') ||
    request.headers.has('X-Ultron-Admin-Token')
  ) {
    return false;
  }
  return CACHEABLE_PATHS.some((re) => re.test(new URL(request.url).pathname));
}

export function classifyOriginPath(pathname: string): BandwidthPathClass {
  if (
    pathname === '/api/brain/deployment-release-authorize' ||
    pathname === '/api/brain/release-passkey' ||
    pathname === '/api/brain/owner-passkeys'
  ) {
    return 'recovery';
  }
  if (pathname.startsWith('/api/brain/release-proof')) {
    return 'workflow';
  }
  return 'discretionary';
}
