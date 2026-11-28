import type { Env } from "./lib";
import { withHeader } from "./lib";
import {
  bandwidthCommand,
  reconcileBandwidth,
  reserveBandwidth,
} from "./bandwidth-client";
import {
  classifyOriginPath,
  isCacheableRequest,
  MAX_CACHE_BUFFER_BYTES,
  normalizeCacheUrl,
  parseContentLength,
  UNKNOWN_LENGTH_ESTIMATE_BYTES,
} from "./bandwidth-policy";

export { isCacheableRequest as isCacheable, normalizeCacheUrl };

function cacheableResponse(res: Response): boolean {
  if (!res.ok) return false;
  if (res.headers.has("Set-Cookie")) return false;
  const cc = (res.headers.get("Cache-Control") ?? "").toLowerCase();
  if (cc.includes("no-store") || cc.includes("private")) return false;
  return true;
}

interface BufferedOriginResponse {
  status: number;
  headers: [string, string][];
  body: ArrayBuffer;
}

const inFlightCacheable = new Map<string, Promise<BufferedOriginResponse | null>>();

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

export function attachStreamingReconcile(
  res: Response,
  env: Env,
  ctx: ExecutionContext,
  reservationId: string,
  reservationDay: string | undefined,
): Response {
  const headerLen = parseContentLength(res.headers.get("Content-Length"));
  if (headerLen !== null) {
    ctx.waitUntil(
      reconcileBandwidth(env, {
        reservationId,
        actualBytes: headerLen,
        day: reservationDay,
      }),
    );
    return res;
  }
  if (!res.body) {
    ctx.waitUntil(
      reconcileBandwidth(env, {
        reservationId,
        actualBytes: 0,
        day: reservationDay,
      }),
    );
    return res;
  }

  let streamedBytes = 0;
  let settled = false;
  const settle = (failed: boolean) => {
    if (settled) return;
    settled = true;
    ctx.waitUntil(
      reconcileBandwidth(env, {
        reservationId,
        actualBytes: streamedBytes,
        day: reservationDay,
        failed,
      }),
    );
  };

  // Single backpressure-preserving stream (no tee / unbounded slow-client buffering).
  const reader = res.body.getReader();
  const clientStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          settle(false);
          controller.close();
          return;
        }
        if (value) {
          streamedBytes += value.byteLength;
          controller.enqueue(value);
        }
      } catch (err) {
        settle(true);
        controller.error(err);
      }
    },
    async cancel(reason) {
      settle(true);
      try {
        await reader.cancel(reason);
      } catch {
        // Ignore upstream cancel errors after settling.
      }
    },
  });

  return new Response(clientStream, {
    status: res.status,
    statusText: res.statusText,
    headers: new Headers(res.headers),
  });
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
  const cacheable = isCacheableRequest(request);
  const normalizedTarget = cacheable ? normalizeCacheUrl(target.toString()) : target.toString();
  const cacheKey = new Request(normalizedTarget, { method: "GET" });

  if (cacheable) {
    const hit = await caches.default.match(cacheKey);
    if (hit) return withHeader(hit, "X-Ultron-Cache", "HIT");

    const pending = inFlightCacheable.get(normalizedTarget);
    if (pending) {
      try {
        const shared = await pending;
        if (shared) {
          return new Response(shared.body.slice(0), {
            status: shared.status,
            headers: new Headers([...shared.headers, ["X-Ultron-Cache", "COALESCED"]]),
          });
        }
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
    const reqLen = parseContentLength(request.headers.get("Content-Length"));
    const estimatedBytes =
      reqLen !== null && reqLen > 0
        ? Math.min(reqLen + 65_536, 10_000_000)
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

    if (env.RATE_LIMITER && reservationId) {
      res = attachStreamingReconcile(res, env, ctx, reservationId, reservationDay);
    }

    if (warning) {
      res = withHeader(res, "X-Ultron-Bandwidth-Warning", "350mb-threshold");
    }
    return res;
  };

  if (cacheable) {
    let resolveCoalesce!: (v: BufferedOriginResponse | null) => void;
    let rejectCoalesce!: (e: unknown) => void;
    const sharedPromise = new Promise<BufferedOriginResponse | null>((resolve, reject) => {
      resolveCoalesce = resolve;
      rejectCoalesce = reject;
    });
    inFlightCacheable.set(normalizedTarget, sharedPromise);

    try {
      const res = await doFetch();
      const declaredLen = parseContentLength(res.headers.get("Content-Length"));
      if (
        !cacheableResponse(res) ||
        (declaredLen !== null && declaredLen > MAX_CACHE_BUFFER_BYTES)
      ) {
        resolveCoalesce(null);
        return withHeader(res, "X-Ultron-Cache", "BYPASS");
      }

      // Bounded read up to MAX_CACHE_BUFFER_BYTES; skip caching if chunked response exceeds cap.
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      let overflow = false;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            total += value.byteLength;
            chunks.push(value);
            if (total > MAX_CACHE_BUFFER_BYTES) {
              overflow = true;
              break;
            }
          }
        }
      }

      if (overflow) {
        resolveCoalesce(null);
        // Reassemble read prefix + remaining stream without buffering further.
        const remainder = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const c of chunks) controller.enqueue(c);
          },
          async pull(controller) {
            if (!reader) {
              controller.close();
              return;
            }
            const { done, value } = await reader.read();
            if (done) controller.close();
            else if (value) controller.enqueue(value);
          },
          cancel() {
            return reader?.cancel();
          },
        });
        return new Response(remainder, {
          status: res.status,
          headers: new Headers([...res.headers.entries(), ["X-Ultron-Cache", "BYPASS"]]),
        });
      }

      const buf = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        buf.set(c, offset);
        offset += c.byteLength;
      }
      const respHeaders = [...res.headers.entries()] as [string, string][];
      const buffered: BufferedOriginResponse = {
        status: res.status,
        headers: respHeaders,
        body: buf.buffer,
      };
      const toCache = new Response(buffered.body.slice(0), {
        status: buffered.status,
        headers: new Headers(buffered.headers),
      });
      toCache.headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
      ctx.waitUntil(caches.default.put(cacheKey, toCache));
      resolveCoalesce(buffered);
      return new Response(buffered.body.slice(0), {
        status: buffered.status,
        headers: new Headers([...buffered.headers, ["X-Ultron-Cache", "MISS"]]),
      });
    } catch (err) {
      rejectCoalesce(err);
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
