import type { EdgeEvent, Env } from "./lib";
import { json } from "./lib";
import { handleAdmin } from "./admin";
import { handleGithubWebhook } from "./webhooks";
import { handleQueue } from "./queue";
import { proxyToOrigin } from "./proxy";
import {
  applyOwnHeaders,
  applyProxyHeaders,
  authorizeAdmin,
  enforceRateLimit,
  policyFor,
  verifyStreamToken,
} from "./security";
import { ReleaseProofWorkflow } from "./workflows/release-proof";
import { StreamHub } from "./durable/stream-hub";
import { RateLimiter } from "./durable/rate-limiter";

export { ReleaseProofWorkflow, StreamHub, RateLimiter };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/__ultron/health") {
      return applyOwnHeaders(
        json({
          ok: true,
          service: "ultron-edge-shield",
          environment: env.ENVIRONMENT,
          ts: new Date().toISOString(),
        }),
      );
    }
    if (path === "/__ultron/webhooks/github") {
      if (request.method !== "POST") {
        return applyOwnHeaders(json({ error: "method_not_allowed" }, 405));
      }
      return handleGithubWebhook(request, env);
    }
    if (path.startsWith("/__ultron/admin")) return handleAdmin(request, env, ctx);
    const policy = policyFor(path);
    if (policy) {
      const verdict = await enforceRateLimit(request, env, policy);
      if (!verdict.allowed) {
        return applyOwnHeaders(
          json({ error: "rate_limited", retryAfter: verdict.retryAfter }, 429, {
            "Retry-After": String(verdict.retryAfter),
          }),
        );
      }
    }
    if (path.startsWith("/__ultron/stream")) return handleStream(request, env);
    return applyProxyHeaders(await proxyToOrigin(request, env, ctx), env);
  },
  async queue(batch: MessageBatch<EdgeEvent>, env: Env): Promise<void> {
    await handleQueue(batch, env);
  },
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.RELEASE_PROOF) return;
    ctx.waitUntil(
      env.RELEASE_PROOF.create({ params: { mode: "watch", reason: "cron" } }),
    );
  },
};

async function handleStream(request: Request, env: Env): Promise<Response> {
  if (!env.STREAM_HUB) {
    return applyOwnHeaders(json({ error: "streaming_unavailable" }, 503));
  }
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const channel = parts[2] ?? "default";
  const action = parts[3] ?? "";
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(channel)) {
    return applyOwnHeaders(json({ error: "invalid_channel" }, 400));
  }
  if (action === "publish") {
    const auth = authorizeAdmin(request, env);
    if (!auth.ok) return applyOwnHeaders(json({ error: auth.reason }, auth.status));
  } else if (action === "ws" || action === "sse") {
    if (!env.STREAM_TOKEN_SECRET) {
      return applyOwnHeaders(json({ error: "stream_token_secret_not_configured" }, 503));
    }
    const token = new URL(request.url).searchParams.get("token");
    if (!(await verifyStreamToken(env.STREAM_TOKEN_SECRET, channel, token))) {
      return applyOwnHeaders(json({ error: "invalid_stream_token" }, 401));
    }
  } else {
    return applyOwnHeaders(json({ error: "not_found" }, 404));
  }
  const stub = env.STREAM_HUB.get(env.STREAM_HUB.idFromName(channel));
  return stub.fetch(request);
}
