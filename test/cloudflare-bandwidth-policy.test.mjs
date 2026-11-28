import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBandwidthAction,
  classifyOriginPath,
  isCacheableRequest,
  LIMIT_BYTES,
  normalizeCacheUrl,
  TARGET_BYTES,
  WARN_BYTES,
} from '../cloudflare/edge-shield/src/bandwidth-policy.ts';

const DAY_MS = Date.parse('2026-11-27T12:00:00Z');

test('provider reading at 400 MB blocks background release checks, preserving 100 MB', () => {
  const { state, result } = applyBandwidthAction(
    null,
    { kind: 'observe', day: '2026-11-27', bytes: TARGET_BYTES },
    DAY_MS,
  );
  assert.equal(result.accepted, true);
  assert.equal(result.limitBytes - result.targetBytes, 100_000_000);
  const check = applyBandwidthAction(state, { kind: 'admit' }, DAY_MS + 1000);
  assert.equal(check.result.allowed, false);
  assert.equal(check.result.reason, 'conservation-threshold');
});

test('unknown usage is not represented as provider measured bytes', () => {
  const { result } = applyBandwidthAction(null, { kind: 'status' }, DAY_MS);
  assert.equal(result.providerBytes, null);
  assert.equal(result.measurement, 'estimate-only');
});

test('reservation cannot cross the operating threshold', () => {
  const state = applyBandwidthAction(
    null,
    { kind: 'observe', day: '2026-11-27', bytes: 399_000_000 },
    DAY_MS,
  ).state;
  const check = applyBandwidthAction(state, { kind: 'admit' }, DAY_MS + 1000);
  assert.equal(check.result.allowed, false);
  assert.equal(check.result.reason, 'conservation-threshold');
  assert.equal(check.result.estimatedBytes, 399_000_000);
});

test('concurrent admission is paced and bounded per UTC day', () => {
  const first = applyBandwidthAction(null, { kind: 'admit' }, DAY_MS);
  assert.equal(first.result.allowed, true);
  assert.equal(first.result.estimatedBytes, 2_000_000);
  const second = applyBandwidthAction(first.state, { kind: 'admit' }, DAY_MS + 10_000);
  assert.equal(second.result.allowed, false);
  assert.equal(second.result.reason, 'paced');
});

test('provider quota hold survives all same-day admissions and resets at UTC midnight', () => {
  const held = applyBandwidthAction(
    null,
    { kind: 'quota-hold', day: '2026-11-27' },
    DAY_MS,
  );
  assert.equal(held.result.quotaHold, true);
  const sameDay = applyBandwidthAction(held.state, { kind: 'admit' }, DAY_MS + 3_600_000);
  assert.equal(sameDay.result.allowed, false);
  assert.equal(sameDay.result.reason, 'provider-quota-hold');
  const nextDay = applyBandwidthAction(
    sameDay.state,
    { kind: 'admit' },
    Date.parse('2026-11-28T00:00:01Z'),
  );
  assert.equal(nextDay.result.allowed, true);
  assert.equal(nextDay.result.quotaHold, false);
});

test('stale-day and decreasing provider readings cannot clear a hold or reduce the estimate', () => {
  const held = applyBandwidthAction(
    null,
    { kind: 'quota-hold', day: '2026-11-27' },
    DAY_MS,
  );
  const observed = applyBandwidthAction(
    held.state,
    { kind: 'observe', day: '2026-11-27', bytes: 100_000 },
    DAY_MS + 1000,
  );
  assert.equal(observed.state.quotaHold, true);
  const stale = applyBandwidthAction(
    observed.state,
    { kind: 'observe', day: '2026-11-26', bytes: 100_000 },
    DAY_MS + 2000,
  );
  assert.equal(stale.result.accepted, false);
  const decreased = applyBandwidthAction(
    observed.state,
    { kind: 'observe', day: '2026-11-27', bytes: 50_000 },
    DAY_MS + 3000,
  );
  assert.equal(decreased.result.accepted, false);
  assert.equal(decreased.state.estimatedBytes, 100_000);
});

test('conservation pacing increases as measured bandwidth rises', () => {
  const state = applyBandwidthAction(
    null,
    { kind: 'observe', day: '2026-11-27', bytes: 380_000_000 },
    DAY_MS,
  ).state;
  const first = applyBandwidthAction(state, { kind: 'admit' }, DAY_MS + 1000);
  assert.equal(first.result.allowed, true);
  const tooSoon = applyBandwidthAction(first.state, { kind: 'admit' }, DAY_MS + 1_800_000);
  assert.equal(tooSoon.result.allowed, false);
  assert.equal(tooSoon.result.reason, 'paced');
});

test('prior-day quota response cannot open the new UTC day circuit', () => {
  const nextDay = Date.parse('2026-11-28T00:00:05Z');
  const staleHold = applyBandwidthAction(
    null,
    { kind: 'quota-hold', day: '2026-11-27' },
    nextDay,
  );
  assert.equal(staleHold.result.accepted, false);
  assert.equal(staleHold.result.reason, 'invalid-or-stale-quota-hold');
  assert.equal(staleHold.state.quotaHold, false);
});

test('quota hold without a valid admission day is rejected', () => {
  const invalid = applyBandwidthAction(
    null,
    { kind: 'quota-hold', day: '' },
    DAY_MS,
  );
  assert.equal(invalid.result.accepted, false);
  assert.equal(invalid.state.quotaHold, false);
});

test('atomic reserve and reconcile prevents concurrent oversubscription and releases unused bytes', () => {
  const state = applyBandwidthAction(
    null,
    { kind: 'observe', day: '2026-11-27', bytes: 398_500_000 },
    DAY_MS,
  ).state;

  const r1 = applyBandwidthAction(
    state,
    { kind: 'reserve', reservationId: 'req-1', bytes: 1_000_000, pathClass: 'discretionary' },
    DAY_MS + 1000,
  );
  assert.equal(r1.result.allowed, true);
  assert.equal(r1.result.warning, true);
  assert.equal(r1.result.estimatedBytes, 399_500_000);

  const dup = applyBandwidthAction(
    r1.state,
    { kind: 'reserve', reservationId: 'req-1', bytes: 1_000_000, pathClass: 'discretionary' },
    DAY_MS + 1001,
  );
  assert.equal(dup.result.accepted, false);
  assert.equal(dup.result.reason, 'duplicate-reservation');

  const r2 = applyBandwidthAction(
    r1.state,
    { kind: 'reserve', reservationId: 'req-2', bytes: 1_000_000, pathClass: 'discretionary' },
    DAY_MS + 1002,
  );
  assert.equal(r2.result.allowed, false);
  assert.equal(r2.result.reason, 'conservation-threshold');

  const rec = applyBandwidthAction(
    r1.state,
    { kind: 'reconcile', reservationId: 'req-1', actualBytes: 10_000, day: '2026-11-27' },
    DAY_MS + 1100,
  );
  assert.equal(rec.result.accepted, true);
  assert.equal(rec.result.reservedBytes, 0);
  assert.equal(rec.result.estimatedBytes, 398_510_000);

  const r2After = applyBandwidthAction(
    rec.state,
    { kind: 'reserve', reservationId: 'req-2', bytes: 1_000_000, pathClass: 'discretionary' },
    DAY_MS + 1200,
  );
  assert.equal(r2After.result.allowed, true);
});

test('failed or aborted request reconciliation releases full reserved bytes with zero committed', () => {
  const r1 = applyBandwidthAction(
    null,
    { kind: 'reserve', reservationId: 'abort-1', bytes: 512_000, pathClass: 'discretionary' },
    DAY_MS,
  );
  assert.equal(r1.result.reservedBytes, 512_000);
  const rec = applyBandwidthAction(
    r1.state,
    { kind: 'reconcile', reservationId: 'abort-1', actualBytes: 0, day: '2026-11-27', failed: true },
    DAY_MS + 500,
  );
  assert.equal(rec.result.accepted, true);
  assert.equal(rec.result.reason, 'reconciled-failed');
  assert.equal(rec.result.reservedBytes, 0);
  assert.equal(rec.result.estimatedBytes, 0);
});

test('recovery path can use bounded headroom below 500 MB while discretionary stops at 400 MB', () => {
  const { state } = applyBandwidthAction(
    null,
    { kind: 'observe', day: '2026-11-27', bytes: 400_000_000 },
    DAY_MS,
  );
  const disc = applyBandwidthAction(
    state,
    { kind: 'reserve', reservationId: 'disc-1', bytes: 512_000, pathClass: 'discretionary' },
    DAY_MS + 1000,
  );
  assert.equal(disc.result.allowed, false);
  assert.equal(disc.result.reason, 'conservation-threshold');

  const rec = applyBandwidthAction(
    state,
    { kind: 'reserve', reservationId: 'rec-1', bytes: 512_000, pathClass: 'recovery' },
    DAY_MS + 1000,
  );
  assert.equal(rec.result.allowed, true);
  assert.ok(rec.result.estimatedBytes < LIMIT_BYTES);
  assert.equal(WARN_BYTES, 350_000_000);
});

test('normalizeCacheUrl strips cache-busters on public assets and never caches private/authenticated requests', () => {
  const normalized = normalizeCacheUrl(
    'https://ultron-mw-cloud.hatchable.site/api/brain/status-public?cb=999&utm_source=x&_t=123',
  );
  assert.equal(
    normalized,
    'https://ultron-mw-cloud.hatchable.site/api/brain/status-public',
  );

  assert.equal(
    isCacheableRequest(new Request('https://edge.example/api/brain/status-public?cb=1')),
    true,
  );
  assert.equal(
    isCacheableRequest(
      new Request('https://edge.example/api/brain/status-public', {
        headers: { Authorization: 'Bearer secret' },
      }),
    ),
    false,
  );
  assert.equal(
    isCacheableRequest(new Request('https://edge.example/api/brain/release-proof')),
    false,
  );
  assert.equal(classifyOriginPath('/api/brain/deployment-release-authorize'), 'recovery');
  assert.equal(classifyOriginPath('/api/brain/release-proof'), 'workflow');
  assert.equal(classifyOriginPath('/api/brain/tasks'), 'discretionary');
});
