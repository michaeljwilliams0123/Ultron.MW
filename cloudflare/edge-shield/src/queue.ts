import type { EdgeEvent, Env } from "./lib";

export async function handleQueue(
  batch: MessageBatch<EdgeEvent>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const e = message.body;
      if (!env.RELEASE_PROOF) {
        message.ack();
        continue;
      }
      if (e.kind === "deploy") {
        await env.RELEASE_PROOF.create({
          params: { mode: "sync", reason: "deploy", repo: e.repo, target: e.target },
        });
        message.ack();
        continue;
      }
      const hasReceiptInputs =
        typeof e.artifactDigest === "string" &&
        e.artifactDigest.length > 0 &&
        typeof e.manifestFileCount === "number";
      if (!hasReceiptInputs) {
        message.ack();
        continue;
      }
      await env.RELEASE_PROOF.create({
        params: {
          mode: "watch",
          reason: e.kind,
          repo: e.repo,
          sourceSha: e.sha,
          artifactDigest: e.artifactDigest,
          manifestFileCount: e.manifestFileCount,
          target: e.target,
        },
      });
      message.ack();
    } catch {
      message.retry({ delaySeconds: 30 });
    }
  }
}
