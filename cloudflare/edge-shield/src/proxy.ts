import type { Env } from "./lib";
import { withHeader } from "./lib";
import {
  bandwidthCommand,
  reconcileBandwidth,
  reserveBandwidth,
} from "./bandwidth-client";
import type { BandwidthPathClass } from "./bandwidth-policy";
import { UNKNOWN_LENGTH_ESTIMATE_BYTES } from "./bandwidth-policy";

const CACHEABLE: RegExp[] = [
  /^\/api\/brain\/status-public$/,
  /^\/ultron-chat\.js$/,
  /^\/ultron-chat\.css$/,
  /^\/ultron-intent\.mjs$/,
  /^\/favicon\.(ico|svg)$/,
  /^\/assets\//,
  /^\/static\//,
];

const CACHE_BUST_PARAMS = new Set(["_", "_t", "t", "ts", "cb", "cachebust", "fbclid"]);

export function normalizeCacheUrl(rawUrl: string): string {
  const u = new URL(rawUrl);
  for (const key of [...u.searchParams.keys()]) {
    if (CACHE_BUST_PARAMS.has(key) || key.startsWith("utm_")) {
      u.searchParams.delete(key);
    }
  }
  u.searchParams.sort();
  return u.toString();
}

export function isCacheable(request: Request): boolean {
  if (request.method !== "GET") return false;
  if (
    request.headers.has("Authorization") ||
    request.headers.has("Cookie") ||
    request.headers.has("X-Ultron-Admin-Token")
  ) {
    return false;
  }
  const { pathname } = new URL(request.url);
  return CACHEABLE.some((re) => re.test(pathname));
}

function cacheableResponse(res: Response): boolean {
  if (!res.ok) return false;
  if (res.headers.has("Set-Cookie")) return false;
  const cc = (res.headers.get("Cache-Control") ?? "").toLowerCase();
  if (cc.includes("no-store") || cc.includes("private")) return false;
  return true;
}

export function classifyOriginPath(pathname: string): BandwidthPathClass {
  if (
    pathname === "/api/brain/deployment-release-authorize" ||
    pathname === "/api/brain/release-passkey" ||
    pathname === "/api/brain/owner-passkeys"
  ) {
    return "recovery";
  }
  if (pathname.startsWith("/api/brain/release-proof")) {
    return "workflow";
  }
  return "discretionary";
}

interface BufferedOriginResponse {
  status: number;
  headers: [string, string][];
  body: ArrayBuffer;
}

const inFlightCacheable = new Map<string, Promise<BufferedOriginResponse>>();

export async function purgeCache(env: Env, paths: string[]) {
  const origin = new URL(env.HATCHABLE_CORE_ORIGIN);
  const results: { path: string; purged: boolean }[] = [];
  for (const p of paths) {
    const url = new URL(p, origin).toString();
    const purged = await caches.default.delete(new Request(url, { method: "GET" }));
    results.push({ path: p, purged });
  }
  return results;
}

export async function proxyToOrigin(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!env.ORIGIN_LOCK_SECRET) {
    return new Response(JSON.stringify({ error: "origin_lock_not_configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  const url = new URL(request.url);
  const origin = new URL(env.HATCHABLE_CORE_ORIGIN);
  const target = new URL(url.pathname + url.search, origin);
  const cacheable = isCacheable(request);
  const normalizedTarget = cacheable ? normalizeCacheUrl(target.toString()) : target.toString();
  const cacheKey = new Request(normalizedTarget, { method: "GET" });

  if (cacheable) {
    const hit = await caches.default.match(cacheKey);
    if (hit) return withHeader(hit, "X-Ultron-Cache", "HIT");

    const pending = inFlightCacheable.get(normalizedTarget);
    if (pending) {
      try {
        const shared = await pending;
        return new Response(shared.body.slice(0), {
          status: shared.status,
          headers: new Headers([...shared.headers, ["X-Ultron-Cache", "COALESCED"]]),
        });
      } catch {
        return new Response(JSON.stringify({ error: "origin_unreachable" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
  }

  let reservationId: string | null = null;
  let reservationDay: string | undefined;
  let warning = false;

  if (env.RATE_LIMITER) {
    reservationId = `proxy-${crypto.randomUUID()}`;
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    const estimatedBytes =
      Number.isSafeInteger(contentLength) && contentLength > 0
        ? Math.min(contentLength + 65_536, 10_000_000)
        : UNKNOWN_LENGTH_ESTIMATE_BYTES;
    const admission = await reserveBandwidth(env, {
      reservationId,
      bytes: estimatedBytes,
      pathClass: classifyOriginPath(url.pathname),
    });
    reservationDay = admission.day;
    warning = admission.warning;
    if (!admission.allowed) {
      return new Response(
        JSON.stringify({
          error: "hatchable_bandwidth_budget_exceeded",
          reason: admission.reason,
          resetAt: admission.resetAt,
          estimatedBytes: admission.estimatedBytes,
          targetBytes: admission.targetBytes,
          coverage: admission.coverage,
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "X-Ultron-Bandwidth-Status": "held",
          },
        },
      );
    }
  }

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("x-ultron-release-proof-ts");
  headers.delete("x-ultron-release-proof-nonce");
  headers.delete("x-ultron-release-proof-mac");
  headers.set("Origin", origin.origin);
  headers.set("X-Ultron-Origin-Lock", env.ORIGIN_LOCK_SECRET);
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", "https");
  headers.set("X-Ultron-Edge", "1");
  const init: RequestInit = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;

  const doFetch = async (): Promise<Response> => {
    let res: Response;
    try {
      res = await fetch(cacheable ? normalizedTarget : target.toString(), init);
    } catch (err) {
      if (env.RATE_LIMITER && reservationId) {
        ctx.waitUntil(
          reconcileBandwidth(env, {
            reservationId,
            actualBytes: 0,
            day: reservationDay,
            failed: true,
          }),
        );
      }
      throw err;
    }

    if (res.status === 429 && env.RATE_LIMITER && reservationDay) {
      ctx.waitUntil(bandwidthCommand(env, { kind: "quota-hold", day: reservationDay }));
    }

    const headerLen = Number(res.headers.get("Content-Length") ?? "");
    if (env.RATE_LIMITER && reservationId) {
      if (Number.isSafeInteger(headerLen) && headerLen >= 0) {
        ctx.waitUntil(
          reconcileBandwidth(env, {
            reservationId,
            actualBytes: headerLen,
            day: reservationDay,
          }),
        );
      } else {
        const clone = res.clone();
        ctx.waitUntil(
          clone
            .arrayBuffer()
            .then((buf) =>
              reconcileBandwidth(env, {
                reservationId: reservationId!,
                actualBytes: buf.byteLength,
                day: reservationDay,
              }),
            )
            .catch(() =>
              reconcileBandwidth(env, {
                reservationId: reservationId!,
                actualBytes: 0,
                day: reservationDay,
                failed: true,
              }),
            ),
        );
      }
    }

    if (warning) {
      res = withHeader(res, "X-Ultron-Bandwidth-Warning", "350mb-threshold");
    }
    return res;
  };

  if (cacheable) {
    const sharedPromise = (async (): Promise<BufferedOriginResponse> => {
      const res = await doFetch();
      const body = await res.arrayBuffer();
      const respHeaders = [...res.headers.entries()] as [string, string][];
      if (cacheableResponse(res)) {
        const toCache = new Response(body.slice(0), {
          status: res.status,
          headers: new Headers(respHeaders),
        });
        toCache.headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
        ctx.waitUntil(caches.default.put(cacheKey, toCache));
      }
      return { status: res.status, headers: respHeaders, body };
    })();

    inFlightCacheable.set(normalizedTarget, sharedPromise);
    try {
      const shared = await sharedPromise;
      return new Response(shared.body.slice(0), {
        status: shared.status,
        headers: new Headers([...shared.headers, ["X-Ultron-Cache", "MISS"]]),
      });
    } catch {
      return new Response(JSON.stringify({ error: "origin_unreachable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    } finally {
      inFlightCacheable.delete(normalizedTarget);
    }
  }

  try {
    return await doFetch();
  } catch {
    return new Response(JSON.stringify({ error: "origin_unreachable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
