import type { EdgeEvent, Env } from "./lib";

const SHA = /^[a-f0-9]{40}$/;

function isReleaseWakeup(e: EdgeEvent, repo: string): boolean {
  if (!e || !repo || e.repo !== repo || !SHA.test(e.sha ?? "")) return false;
  return (e.kind === "push" && e.branch === "main") ||
    (e.kind === "check_suite" && e.conclusion === "success") ||
    e.kind === "deploy";
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
      // Events are wake-up hints only, not release evidence or authority.
      // Never forward event-provided manifest inputs or purge before proof.
      await env.RELEASE_PROOF.create({
        params: { mode: "watch", reason: e.kind, repo: env.GITHUB_REPO, sourceSha: e.sha },
      });
      message.ack();
    } catch {
      message.retry({ delaySeconds: 30 });
    }
  }
}
