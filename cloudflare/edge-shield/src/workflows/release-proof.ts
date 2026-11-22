import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env, ReleaseProofParams, ReleaseRequest } from "../lib";
import { buildKey } from "../lib";
import { purgeCache } from "../proxy";

const COUNCIL_APP_ID = 5765239;
const COUNCIL_CHECK_NAME = "ultron/council-7of7";

interface Gates {
  sourceSha: string | null;
  prHeadSha: string | null;
  ci: { conclusion: string | null; runId: number | null; headSha: string | null };
  council: {
    conclusion: string | null;
    name: string | null;
    appId: number | null;
    headSha: string | null;
  };
  live: { ok: boolean; version: string | null; sha: string | null };
  passed: boolean;
  blocking: string[];
}

export class ReleaseProofWorkflow extends WorkflowEntrypoint<Env, ReleaseProofParams> {
  async run(event: WorkflowEvent<ReleaseProofParams>, step: WorkflowStep) {
    const p = event.payload;
    const repo = p.repo ?? this.env.GITHUB_REPO;
    const gates = await step.do(
      "gather-gates",
      {
        retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
        timeout: "2 minutes",
      },
      () => this.gatherGates(repo),
    );
    if (!gates.passed) return { status: "blocked", gates };
    if (p.mode === "sync") {
      const purged = await step.do("purge-edge-cache", () =>
        purgeCache(this.env, ["/api/brain/status-public", "/"]),
      );
      const lock = await step.do("verify-origin-lock", () => this.verifyOriginLock());
      return { status: lock.ok ? "synced" : "origin_lock_failed", gates, purged, lock };
    }
    const built = await step.do("build-receipt", async () => {
      const missing: string[] = [];
      if (!gates.sourceSha) missing.push("sourceSha");
      if (!p.artifactDigest) missing.push("artifactDigest");
      if (typeof p.manifestFileCount !== "number") missing.push("manifestFileCount");
      if (!p.target) missing.push("target");
      if (missing.length) return { complete: false as const, missing };

      const request: ReleaseRequest = {
        key: buildKey(p.target!, gates.sourceSha!),
        target: p.target!,
        sourceSha: gates.sourceSha!,
        artifactDigest: p.artifactDigest!,
        manifestFileCount: p.manifestFileCount!,
        independentReadback: true,
      };
      return { complete: true as const, request };
    });

    if (!built.complete) {
      return { status: "incomplete_receipt", gates, missing: built.missing };
    }

    return {
      status: "awaiting_signature",
      gates,
      request: built.request,
      submitTo: "/__ultron/admin/release-proof/submit",
    };
  }

  private async gh(path: string): Promise<any | null> {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ultron-edge-shield",
        ...(this.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${this.env.GITHUB_TOKEN}` }
          : {}),
      },
    });
    if (!res.ok) return null;
    return res.json<any>();
  }

  private async gatherGates(repo: string): Promise<Gates> {
    const blocking: string[] = [];
    const commit = await this.gh(`/repos/${repo}/commits/main`);
    const sourceSha: string | null = commit?.sha ?? null;
    if (!sourceSha) blocking.push("github_main_sha");
    let ci: Gates["ci"] = { conclusion: null, runId: null, headSha: null };
    if (sourceSha) {
      const runs = await this.gh(
        `/repos/${repo}/actions/workflows/verify.yml/runs?head_sha=${sourceSha}&per_page=10`,
      );
      const run = (runs?.workflow_runs ?? []).find((r: any) => r.head_sha === sourceSha);
      ci = {
        conclusion: run?.conclusion ?? null,
        runId: run?.id ?? null,
        headSha: run?.head_sha ?? null,
      };
    }
    if (ci.conclusion !== "success") blocking.push("verify_ci");
    let prHeadSha: string | null = null;
    if (sourceSha) {
      const pulls = await this.gh(`/repos/${repo}/commits/${sourceSha}/pulls`);
      const merged = (pulls ?? []).find((pr: any) => pr.merged_at);
      prHeadSha = merged?.head?.sha ?? null;
    }
    if (!prHeadSha) blocking.push("merged_pr_head");
    let council: Gates["council"] = {
      conclusion: null,
      name: null,
      appId: null,
      headSha: prHeadSha,
    };
    if (prHeadSha) {
      const checks = await this.gh(
        `/repos/${repo}/commits/${prHeadSha}/check-runs?per_page=100`,
      );
      const run = (checks?.check_runs ?? []).find(
        (c: any) => c.name === COUNCIL_CHECK_NAME && c.app?.id === COUNCIL_APP_ID,
      );
      council = {
        conclusion: run?.conclusion ?? null,
        name: run?.name ?? null,
        appId: run?.app?.id ?? null,
        headSha: prHeadSha,
      };
    }
    if (council.conclusion !== "success") blocking.push("council_7of7");
    let live: Gates["live"] = { ok: false, version: null, sha: null };
    try {
      const res = await fetch(
        new URL("/api/brain/status-public", this.env.HATCHABLE_CORE_ORIGIN).toString(),
        {
          headers: this.env.ORIGIN_LOCK_SECRET
            ? { "X-Ultron-Origin-Lock": this.env.ORIGIN_LOCK_SECRET }
            : {},
        },
      );
      if (res.ok) {
        const body: any = await res.json().catch(() => ({}));
        live = {
          ok: true,
          version: body?.version ?? null,
          sha: body?.sha ?? body?.sourceSha ?? null,
        };
      }
    } catch {
      // origin unreachable
    }
    if (!live.ok) blocking.push("hatchable_live_status");
    return { sourceSha, prHeadSha, ci, council, live, passed: blocking.length === 0, blocking };
  }

  private async verifyOriginLock() {
    const url = new URL(
      this.env.ORIGIN_LOCK_PROBE_PATH || "/api/brain/origin-lock-probe",
      this.env.HATCHABLE_CORE_ORIGIN,
    ).toString();
    const ua = "ultron-edge-shield/lockcheck";
    const bare = await fetch(url, { headers: { "User-Agent": ua } });
    const locked = this.env.ORIGIN_LOCK_SECRET
      ? await fetch(url, {
          headers: { "User-Agent": ua, "X-Ultron-Origin-Lock": this.env.ORIGIN_LOCK_SECRET },
        })
      : null;
    const enforced = bare.status === 401 || bare.status === 403;
    const accepted = locked?.ok ?? false;
    return {
      ok: enforced && accepted,
      enforced,
      accepted,
      bareStatus: bare.status,
      lockedStatus: locked?.status ?? 0,
    };
  }
}
