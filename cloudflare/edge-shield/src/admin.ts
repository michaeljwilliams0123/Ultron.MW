import type { Env } from "./lib";
import { json } from "./lib";
import { applyOwnHeaders, authorizeAdmin, signStreamToken } from "./security";
import { purgeCache } from "./proxy";
import { bandwidthCommand } from './bandwidth-client';

export async function handleAdmin(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const auth = authorizeAdmin(request, env);
  if (!auth.ok) return applyOwnHeaders(json({ error: auth.reason }, auth.status));
  const route = new URL(request.url).pathname.replace("/__ultron/admin", "") || "/";
  if(route==='/bandwidth' && (request.method==='GET'||request.method==='POST')){
    try{
      if(request.method==='GET')return applyOwnHeaders(json(await bandwidthCommand(env,{kind:'status'})));
      const body=await request.json().catch(()=>null) as {day?:string;bytes?:number}|null;
      if(typeof body?.day!=='string'||typeof body.bytes!=='number'||!Number.isSafeInteger(body.bytes)||body.bytes<0)return applyOwnHeaders(json({error:'provider_day_and_bytes_required'},400));
      const result=await bandwidthCommand(env,{kind:'observe',day:body.day,bytes:body.bytes});
      return applyOwnHeaders(json(result,result.accepted?200:400));
    }catch{return applyOwnHeaders(json({error:'bandwidth_governor_unavailable'},503));}
  }
  if (route === "/status" && request.method === "GET") {
    return applyOwnHeaders(
      json({
        service: "ultron-edge-shield",
        environment: env.ENVIRONMENT,
        owner: env.OWNER_LOGIN,
        origin: env.HATCHABLE_CORE_ORIGIN,
        receiptPath: env.HATCHABLE_RECEIPT_PATH,
        probePath: env.ORIGIN_LOCK_PROBE_PATH,
        repo: env.GITHUB_REPO,
        bindings: {
          events: Boolean(env.EVENTS),
          releaseProof: Boolean(env.RELEASE_PROOF),
          streamHub: Boolean(env.STREAM_HUB),
          rateLimiter: Boolean(env.RATE_LIMITER),
        },
        ts: new Date().toISOString(),
      }),
    );
  }
  if (route === "/config" && request.method === "GET") {
    return applyOwnHeaders(
      json({
        secrets: {
          GITHUB_WEBHOOK_SECRET: Boolean(env.GITHUB_WEBHOOK_SECRET),
          ORIGIN_LOCK_SECRET: Boolean(env.ORIGIN_LOCK_SECRET),
          ADMIN_TOKEN: Boolean(env.ADMIN_TOKEN),
          GITHUB_TOKEN: Boolean(env.GITHUB_TOKEN),
          STREAM_TOKEN_SECRET: Boolean(env.STREAM_TOKEN_SECRET),
        },
      }),
    );
  }
  if (route === "/purge" && request.method === "POST") {
    const body: any = await request.json().catch(() => null);
    const paths = Array.isArray(body?.paths)
      ? body.paths.filter((p: unknown) => typeof p === "string")
      : [];
    if (!paths.length) return applyOwnHeaders(json({ error: "paths_required" }, 400));
    if (paths.length > 50) return applyOwnHeaders(json({ error: "too_many_paths" }, 400));
    return applyOwnHeaders(json({ purged: await purgeCache(env, paths) }));
  }
  if (route === "/stream/token" && request.method === "POST") {
    if (!env.STREAM_TOKEN_SECRET) {
      return applyOwnHeaders(json({ error: "stream_token_secret_not_configured" }, 503));
    }
    const body: any = await request.json().catch(() => null);
    const channel = typeof body?.channel === "string" ? body.channel : "";
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(channel)) {
      return applyOwnHeaders(json({ error: "invalid_channel" }, 400));
    }
    const ttlSeconds = Math.min(Math.max(Number(body?.ttlSeconds ?? 300), 30), 3600);
    const exp = Date.now() + ttlSeconds * 1000;
    const token = await signStreamToken(env.STREAM_TOKEN_SECRET, channel, exp);
    return applyOwnHeaders(json({ channel, token, exp, ttlSeconds }));
  }
  if (route === "/release-proof/run" && request.method === "POST") {
    if (!env.RELEASE_PROOF) return applyOwnHeaders(json({ error: "workflows_unavailable" }, 503));
    const instance = await env.RELEASE_PROOF.create({
      params: { mode: "watch", reason: "manual" },
    });
    return applyOwnHeaders(json({ ok: true, instanceId: instance.id }));
  }
  if (route === "/release-proof/sync" && request.method === "POST") {
    if (!env.RELEASE_PROOF) return applyOwnHeaders(json({ error: "workflows_unavailable" }, 503));
    const instance = await env.RELEASE_PROOF.create({
      params: { mode: "sync", reason: "manual" },
    });
    return applyOwnHeaders(json({ ok: true, instanceId: instance.id }));
  }
  if (route === "/release-proof/submit" && request.method === "POST") {
    if (!env.ORIGIN_LOCK_SECRET) {
      return applyOwnHeaders(json({ error: "origin_lock_not_configured" }, 503));
    }
    const cookie = request.headers.get("Cookie");
    if (!cookie) {
      return applyOwnHeaders(json({ error: "owner_session_required" }, 401));
    }
    const body: any = await request.json().catch(() => null);
    const req = body?.request;
    const envelope = body?.envelope;
    if (!req || typeof req !== "object" || !envelope || typeof envelope !== "object") {
      return applyOwnHeaders(json({ error: "request_and_envelope_required" }, 400));
    }
    const origin = new URL(env.HATCHABLE_CORE_ORIGIN);
    const path = env.HATCHABLE_RECEIPT_PATH || "/api/brain/deployment-release-receipt";
    const res = await fetch(new URL(path, origin).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin.origin,
        "X-Ultron-Origin-Lock": env.ORIGIN_LOCK_SECRET,
        Cookie: cookie,
      },
      body: JSON.stringify({ mode: "submit", request: req, envelope }),
    });
    const text = await res.text().catch(() => "");
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave as text
    }
    return applyOwnHeaders(json({ ok: res.ok, status: res.status, body: parsed }));
  }
  return applyOwnHeaders(json({ error: "not_found" }, 404));
}
