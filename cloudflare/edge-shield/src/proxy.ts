import type { Env } from "./lib";
import { withHeader } from "./lib";

const CACHEABLE: RegExp[] = [
  /^\/api\/brain\/status-public$/,
  /^\/ultron-chat\.js$/,
  /^\/ultron-chat\.css$/,
  /^\/ultron-intent\.mjs$/,
  /^\/favicon\.(ico|svg)$/,
  /^\/assets\//,
  /^\/static\//,
];

export function isCacheable(request: Request): boolean {
  if (request.method !== "GET") return false;
  if (request.headers.has("Authorization") || request.headers.has("Cookie")) return false;
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
  const cacheKey = new Request(target.toString(), { method: "GET" });
  if (cacheable) {
    const hit = await caches.default.match(cacheKey);
    if (hit) return withHeader(hit, "X-Ultron-Cache", "HIT");
  }
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("Origin", origin.origin);
  headers.set("X-Ultron-Origin-Lock", env.ORIGIN_LOCK_SECRET);
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", "https");
  headers.set("X-Ultron-Edge", "1");
  const init: RequestInit = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
  let res: Response;
  try {
    res = await fetch(target.toString(), init);
  } catch {
    return new Response(JSON.stringify({ error: "origin_unreachable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (cacheable && cacheableResponse(res)) {
    const toCache = new Response(res.clone().body, {
      status: res.status,
      headers: new Headers(res.headers),
    });
    toCache.headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
    ctx.waitUntil(caches.default.put(cacheKey, toCache));
    res = withHeader(res, "X-Ultron-Cache", "MISS");
  }
  return res;
}
