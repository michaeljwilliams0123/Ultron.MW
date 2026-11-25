import type { EdgeEvent, Env } from "./lib";

const SHA = /^[a-f0-9]{40}$/;
const DELIVERY_ID = /^[a-zA-Z0-9_-]{8,128}$/;

function isReleaseWakeup(e: EdgeEvent, repo: string): boolean {
  if (!e || !repo || e.repo !== repo || !SHA.test(e.sha ?? "")) return false;
  return (e.kind === "push" && e.branch === "main") ||
    (e.kind === "check_suite" && e.conclusion === "success") ||
    e.kind === "deploy";
}

export async function deriveWorkflowInstanceId(
  repo: string,
  kind: EdgeEvent["kind"],
  sourceSha: string,
  delivery?: string,
): Promise<string> {
  const deliveryClass = delivery && DELIVERY_ID.test(delivery) ? delivery : "no-delivery";
  const input = new TextEncoder().encode(`${repo}\n${kind}\n${sourceSha}\n${deliveryClass}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `rp-${hex.slice(0, 48)}`;
}

function isDuplicateWorkflowError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err ?? "").toLowerCase();
  const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: unknown }).code : undefined;
  return code === 10200 || msg.includes("already exists") || msg.includes("duplicate");
}

export async function handleQueue(
  batch: MessageBatch<EdgeEvent>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const e = message.body;
      if (!isReleaseWakeup(e, env.GITHUB_REPO)) {
        message.ack();
        continue;
      }
      if (!env.RELEASE_PROOF) {
        // The lite deployment lacks this binding. Surface the unprocessed
        // event through the bounded retry/DLQ path rather than silently losing it.
        message.retry({ delaySeconds: 30 });
        continue;
      }
      const id = await deriveWorkflowInstanceId(env.GITHUB_REPO, e.kind, e.sha!, e.delivery);
      // Events are wake-up hints only, not release evidence or authority.
      // Never forward event-provided manifest inputs or purge before proof.
      try {
        await env.RELEASE_PROOF.create({
          id,
          params: { mode: "watch", reason: e.kind, repo: env.GITHUB_REPO, sourceSha: e.sha },
        });
      } catch (err) {
        if (!isDuplicateWorkflowError(err)) throw err;
      }
      message.ack();
    } catch {
      message.retry({ delaySeconds: 30 });
    }
  }
}
