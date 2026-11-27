import type { EdgeEvent, Env } from "./lib";
import { json } from "./lib";
import { applyOwnHeaders, verifyGithubSignature } from "./security";

export async function handleGithubWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_WEBHOOK_SECRET) {
    return applyOwnHeaders(json({ error: "webhook_secret_not_configured" }, 503));
  }
  const raw = await request.text();
  const signature = request.headers.get("X-Hub-Signature-256");
  if (!(await verifyGithubSignature(env.GITHUB_WEBHOOK_SECRET, raw, signature))) {
    return applyOwnHeaders(json({ error: "invalid_signature" }, 401));
  }
  const event = request.headers.get("X-GitHub-Event") ?? "";
  const delivery = request.headers.get("X-GitHub-Delivery") ?? crypto.randomUUID();
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return applyOwnHeaders(json({ error: "invalid_json" }, 400));
  }
  const mapped = mapEvent(event, payload, delivery);
  if (!mapped || mapped.repo !== env.GITHUB_REPO) {
    return applyOwnHeaders(json({ ok: true, ignored: event, delivery }, 202));
  }
  await env.EVENTS.send(mapped);
  return applyOwnHeaders(json({ ok: true, queued: mapped.kind, delivery }, 202));
}

function mapEvent(event: string, payload: any, delivery: string): EdgeEvent | null {
  const repo = payload?.repository?.full_name;
  if (!repo) return null;
  const base = { delivery, repo, receivedAt: new Date().toISOString() };
  if (event === "push") {
    if (payload.ref !== "refs/heads/main") return null;
    return { ...base, kind: "push", branch: "main", sha: payload.after };
  }
  if (event === "check_suite") {
    if (payload.action !== "completed" || payload.check_suite?.head_branch !== "main" || payload.check_suite?.conclusion !== "success") return null;
    if (payload.check_suite?.head_repository?.full_name && payload.check_suite.head_repository.full_name !== repo) return null;
    return {
      ...base,
      kind: "check_suite",
      branch: "main",
      sha: payload.check_suite?.head_sha,
      conclusion: payload.check_suite?.conclusion,
    };
  }
  if (event === "deployment_status") {
    if (payload.deployment_status?.state !== "success") return null;
    return {
      ...base,
      kind: "deploy",
      sha: payload.deployment?.sha,
      target: payload.deployment?.environment,
    };
  }
  return null;
}
