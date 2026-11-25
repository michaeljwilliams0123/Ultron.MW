import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env, ReleaseProofParams } from "../lib";
import { purgeCache } from "../proxy";
import { readCanonicalReleaseProof } from "../release-readback";

export class ReleaseProofWorkflow extends WorkflowEntrypoint<Env, ReleaseProofParams> {
  async run(event: WorkflowEvent<ReleaseProofParams>, step: WorkflowStep) {
    const p = event.payload;
    if (p.repo && p.repo !== this.env.GITHUB_REPO) return { status: "wrong-repository" };
    const proof = await step.do("canonical-release-readback", {
      retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
      timeout: "2 minutes",
    }, () => readCanonicalReleaseProof({origin:this.env.HATCHABLE_CORE_ORIGIN,secret:this.env.ORIGIN_LOCK_SECRET}));
    if (!proof.verified) return { status: "blocked", proof };
    if (p.sourceSha && p.sourceSha !== proof.commitSha) return { status: "superseded-event", proof };
    if (p.mode !== "sync") return { status: "verified", proof };
    const lock = await step.do("verify-origin-lock", () => this.verifyOriginLock());
    if (!lock.ok) return { status: "origin_lock_failed", proof, lock };
    const purged = await step.do("purge-edge-cache", () => purgeCache(this.env, ["/api/brain/status-public", "/"]));
    return { status: "synced", proof, purged, lock };
  }
  private async verifyOriginLock() {
    const path = this.env.ORIGIN_LOCK_PROBE_PATH || "/api/brain/origin-lock-probe";
    if (path !== "/api/brain/origin-lock-probe" || this.env.HATCHABLE_CORE_ORIGIN !== "https://ultron-mw-cloud.hatchable.site") throw Error("origin-lock-probe-out-of-scope");
    const url = new URL(path, this.env.HATCHABLE_CORE_ORIGIN).toString();
    const ua = "ultron-edge-shield/lockcheck";
    const bare = await fetch(url, { headers: { "User-Agent": ua },redirect:"error" });
    const locked = this.env.ORIGIN_LOCK_SECRET ? await fetch(url, {
      headers: { "User-Agent": ua, "X-Ultron-Origin-Lock": this.env.ORIGIN_LOCK_SECRET },redirect:"error",
    }) : null;
    const enforced = bare.status === 401 || bare.status === 403, accepted = locked?.ok ?? false;
    return {ok:enforced&&accepted,enforced,accepted,bareStatus:bare.status,lockedStatus:locked?.status??0};
  }
}
