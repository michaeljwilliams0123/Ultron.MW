import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env, ReleaseProofParams } from "../lib";
import { purgeCache } from "../proxy";
import { readReleaseProofForWorkflow } from "../release-readback";
import {
  bandwidthCommand,
  reconcileBandwidth,
  reserveBandwidth,
} from "../bandwidth-client";
import { shouldWakeAuthorization, dispatchReleaseAuthorization } from "../release-authorization";

export class ReleaseProofWorkflow extends WorkflowEntrypoint<Env, ReleaseProofParams> {
  async run(event: WorkflowEvent<ReleaseProofParams>, step: WorkflowStep) {
    const p = event.payload;
    if (p.repo && p.repo !== this.env.GITHUB_REPO) return { status: "wrong-repository" };
    const admission = await step.do(
      "bandwidth-admission",
      { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" },
      () => bandwidthCommand(this.env, { kind: "admit" }),
    );
    if (!admission.allowed) return { status: "held", reason: admission.reason, bandwidth: admission };
    const observation = await step.do(
      "canonical-release-readback",
      {
        retries: { limit: 0, delay: "10 seconds", backoff: "exponential" },
        timeout: "2 minutes",
      },
      () =>
        readReleaseProofForWorkflow({
          origin: this.env.HATCHABLE_CORE_ORIGIN,
          secret: this.env.ORIGIN_LOCK_SECRET,
        }),
    );
    // No retries or downstream actions for quota/authority denial; no cached proof.
    if (observation.status === "held" && observation.httpStatus === 429) {
      await step.do("persist-origin-quota-hold", () =>
        bandwidthCommand(this.env, { kind: "quota-hold", day: admission.day }),
      );
    }
    if (observation.status === "held") return observation;
    const proof = observation.proof;
    if (!proof.verified) {
      if (p.mode === "watch" && shouldWakeAuthorization(proof, p.sourceSha) && proof.commitSha) {
        const sourceSha = proof.commitSha;
        const authResId = `wf-auth-${event.instanceId}`;
        const authReserve = await step.do("reserve-auth-wakeup", () =>
          reserveBandwidth(this.env, {
            reservationId: authResId,
            bytes: 65_536,
            pathClass: "recovery",
          }),
        );
        if (!authReserve.allowed) {
          return { status: "held", reason: authReserve.reason, bandwidth: authReserve };
        }
        const wakeup = await step.do(
          "wake-release-authorization",
          {
            retries: { limit: 2, delay: "30 seconds", backoff: "exponential" },
            timeout: "1 minute",
          },
          async () => {
            try {
              const out = await dispatchReleaseAuthorization({
                origin: this.env.HATCHABLE_CORE_ORIGIN,
                secret: this.env.ORIGIN_LOCK_SECRET,
                sourceSha,
              });
              await reconcileBandwidth(this.env, {
                reservationId: authResId,
                actualBytes: JSON.stringify(out).length,
                day: authReserve.day,
              });
              return out;
            } catch (err) {
              await reconcileBandwidth(this.env, {
                reservationId: authResId,
                actualBytes: 0,
                day: authReserve.day,
                failed: true,
              });
              throw err;
            }
          },
        );
        return { status: "authorization-wakeup", proof, wakeup };
      }
      return { status: "blocked", proof };
    }
    if (p.sourceSha && p.sourceSha !== proof.commitSha) return { status: "superseded-event", proof };
    if (p.mode !== "sync") return { status: "verified", proof };
    const lock = await step.do("verify-origin-lock", () =>
      this.verifyOriginLock(event.instanceId),
    );
    if (!lock.ok) return { status: "origin_lock_failed", proof, lock };
    const purged = await step.do("purge-edge-cache", () =>
      purgeCache(this.env, ["/api/brain/status-public", "/"]),
    );
    return { status: "synced", proof, purged, lock };
  }

  private async verifyOriginLock(instanceId: string) {
    const path = this.env.ORIGIN_LOCK_PROBE_PATH || "/api/brain/origin-lock-probe";
    if (
      path !== "/api/brain/origin-lock-probe" ||
      this.env.HATCHABLE_CORE_ORIGIN !== "https://ultron-mw-cloud.hatchable.site"
    ) {
      throw Error("origin-lock-probe-out-of-scope");
    }
    const lockResId = `wf-lock-${instanceId}`;
    const lockReserve = await reserveBandwidth(this.env, {
      reservationId: lockResId,
      bytes: 65_536,
      pathClass: "recovery",
    });
    if (!lockReserve.allowed) {
      return {
        ok: false,
        enforced: false,
        accepted: false,
        bareStatus: 503,
        lockedStatus: 0,
        reason: lockReserve.reason,
      };
    }
    const url = new URL(path, this.env.HATCHABLE_CORE_ORIGIN).toString();
    const ua = "ultron-edge-shield/lockcheck";
    let actualBytes = 0;
    try {
      const bare = await fetch(url, { headers: { "User-Agent": ua }, redirect: "error" });
      actualBytes += (await bare.arrayBuffer()).byteLength;
      if (bare.status === 429) {
        await bandwidthCommand(this.env, { kind: "quota-hold", day: lockReserve.day });
      }
      const locked = this.env.ORIGIN_LOCK_SECRET
        ? await fetch(url, {
            headers: { "User-Agent": ua, "X-Ultron-Origin-Lock": this.env.ORIGIN_LOCK_SECRET },
            redirect: "error",
          })
        : null;
      if (locked) {
        actualBytes += (await locked.arrayBuffer()).byteLength;
        if (locked.status === 429) {
          await bandwidthCommand(this.env, { kind: "quota-hold", day: lockReserve.day });
        }
      }
      await reconcileBandwidth(this.env, {
        reservationId: lockResId,
        actualBytes,
        day: lockReserve.day,
      });
      const enforced = bare.status === 401 || bare.status === 403;
      const accepted = locked?.ok ?? false;
      return {
        ok: enforced && accepted,
        enforced,
        accepted,
        bareStatus: bare.status,
        lockedStatus: locked?.status ?? 0,
      };
    } catch (err) {
      await reconcileBandwidth(this.env, {
        reservationId: lockResId,
        actualBytes,
        day: lockReserve.day,
        failed: true,
      });
      throw err;
    }
  }
}
