"""Report actual paired Repair App source behavior to a real ephemeral Reef runtime.

Reef records the per-case inference exchange and scored feedback. The upstream
is deliberately a deterministic no-cost protocol fixture, NOT a model or
trained harness. This is observable behavior + receipt plumbing, not Reef
harness evolution, held-out certification, or merge approval.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
from http.server import ThreadingHTTPServer
from importlib.metadata import version
from pathlib import Path

if __package__:
    from .reef_ci_probe import (PORT_REEF, PORT_UPSTREAM, FixtureHandler,
                                request, validate_upstream_response)
else:
    from reef_ci_probe import (PORT_REEF, PORT_UPSTREAM, FixtureHandler,
                               request, validate_upstream_response)

ROOT = Path(__file__).resolve().parent.parent
SHA = re.compile(r"^[0-9a-f]{40}$")
RECEIPT = re.compile(r"^[a-zA-Z0-9_.:-]{8,128}$")


def validate_pairs(report: dict, base_sha: str, candidate_sha: str) -> list[dict]:
    if not isinstance(report, dict) or report.get("schema") != "ultron.reef-paired-policy-benchmark.v1":
        raise ValueError("Paired harness report schema missing")
    if (not SHA.fullmatch(base_sha) or not SHA.fullmatch(candidate_sha)
            or base_sha == candidate_sha or report.get("baseSha") != base_sha
            or report.get("candidateSha") != candidate_sha):
        raise ValueError("Paired source SHA lineage changed")
    for key in ("baselineArtifactSha256", "candidateArtifactSha256", "caseManifestSha256"):
        if not isinstance(report.get(key), str) or not re.fullmatch(r"[0-9a-f]{64}", report[key]):
            raise ValueError("Paired artifact digest missing")
    cases = report.get("caseResults")
    if not isinstance(cases, list) or len(cases) < 8:
        raise ValueError("Paired cases missing")
    ids = set()
    splits = {"development": 0, "heldout": 0}
    for row in cases:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or row["id"] in ids:
            raise ValueError("Duplicate or missing case ID")
        ids.add(row["id"])
        if row.get("split") not in splits or type(row.get("critical")) is not bool:
            raise ValueError("Invalid held-out classification")
        splits[row["split"]] += 1
        for side in ("baseline", "candidate"):
            result = row.get(side)
            if (not isinstance(result, dict) or type(result.get("score")) not in (int, float)
                    or result["score"] not in (0, 1)
                    or result.get("status") != ("succeeded" if result["score"] == 1 else "failed")
                    or result.get("invariantsPassed") is not (result["score"] == 1)):
                raise ValueError("Invalid independently scored case")
    if splits["development"] < 2 or splits["heldout"] < 4:
        raise ValueError("Disjoint benchmark minimum not met")
    return cases


def build_receipt_report(raw: dict, *, base_sha: str, head_sha: str,
                         reef_version: str, receipts: list[dict],
                         trusted_evaluator: bool, release_count: int) -> dict:
    cases = validate_pairs(raw, base_sha, head_sha)
    expected = {(row["id"], side) for row in cases for side in ("baseline", "candidate")}
    seen = set()
    for item in receipts:
        if not isinstance(item, dict):
            raise ValueError("Invalid Reef feedback evidence")
        key = (item.get("caseId"), item.get("variant"))
        if (key not in expected or key in seen or
                not isinstance(item.get("inferenceReceipt"), str) or
                not RECEIPT.fullmatch(item["inferenceReceipt"]) or
                not isinstance(item.get("feedbackReceipt"), str) or
                not RECEIPT.fullmatch(item["feedbackReceipt"])):
            raise ValueError("Missing or duplicated Reef case receipts")
        seen.add(key)
    if seen != expected or release_count < 1 or not reef_version:
        raise ValueError("Incomplete Reef case evidence")
    heldout = [row for row in cases if row["split"] == "heldout"]
    delta = (sum(row["candidate"]["score"] for row in heldout)
             - sum(row["baseline"]["score"] for row in heldout)) / len(heldout)
    regressions = sum(1 for row in heldout if row["candidate"]["score"] < row["baseline"]["score"])
    return {
        "schema": "ultron.reef-paired-feedback.v1",
        "baseSha": base_sha, "headSha": head_sha,
        "track": "168-repair-app-admission",
        "baselineArtifactSha256": raw["baselineArtifactSha256"],
        "candidateArtifactSha256": raw["candidateArtifactSha256"],
        "caseManifestSha256": raw["caseManifestSha256"],
        "reefVersion": reef_version,
        "reefRuntimeVerified": True,
        "reefFeedbackVerified": True,
        "receiptCount": len(receipts),
        "receipts": receipts,
        "releaseCount": release_count,
        "heldoutDelta": delta,
        "criticalRegressions": regressions,
        "evaluatorFromProtectedBase": trusted_evaluator,
        "upstream": "loopback-deterministic-fixture",
        "actualBehaviorEvaluated": True,
        "modelWeightsTrained": False,
        "reefHarnessOptimized": False,
        "independentHeldoutCertified": False,
        "eligibleForMerge": False,
        "disposition": "BLOCKED_HARNESS_OPTIMIZATION_AND_INDEPENDENT_REVIEW_PENDING",
    }


def main() -> dict:
    base_sha = os.environ.get("BASE_SHA", "")
    head_sha = os.environ.get("HEAD_SHA", "")
    artifact = ROOT / "artifacts" / "reef-paired-source-benchmark.json"
    raw = json.loads(artifact.read_text(encoding="utf-8"))
    cases = validate_pairs(raw, base_sha, head_sha)
    reef_version = version("reef-infra")
    # The evaluator is independently sourced from the base commit only when
    # the GitHub workflow has extracted and executed the base revision.
    trusted = os.environ.get("BASE_EVALUATOR_USED") == "true"
    token = secrets.token_hex(20)
    upstream = ThreadingHTTPServer(("127.0.0.1", PORT_UPSTREAM), FixtureHandler)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    log = ROOT / "artifacts" / "reef-paired-local.log"
    cmd = [
        "reef", "serve",
        "--inference.upstream-url", f"http://127.0.0.1:{PORT_UPSTREAM}",
        "--inference.upstream-model", "ci-deterministic-fixture",
        "--reef.port", str(PORT_REEF),
    ]
    process = None
    try:
        with log.open("w", encoding="utf-8") as stream:
            process = subprocess.Popen(
                cmd, cwd=ROOT,
                env={**os.environ, "REEF_TOKEN": token, "REEF_UPSTREAM_API_KEY": "ci-fixture"},
                stdout=stream, stderr=subprocess.STDOUT,
            )
            ready = False
            for _ in range(90):
                if process.poll() is not None:
                    raise RuntimeError("Reef paired runtime terminated before ready")
                try:
                    health, _ = request("/healthz", token)
                    if isinstance(health, dict) and health.get("ok") is True:
                        ready = True
                        break
                except (urllib.error.URLError, TimeoutError, OSError):
                    time.sleep(1)
            if not ready:
                raise RuntimeError("Reef paired runtime failed readiness")
            scenario = "ultron-repair-paired-policy-eval"
            receipts = []
            for row in cases:
                for side in ("baseline", "candidate"):
                    # Only public case metadata is served; no private task input.
                    message = f"{row['id']} {side} {base_sha if side == 'baseline' else head_sha}"
                    response, headers = request(
                        "/v1/chat/completions", token, scenario=scenario,
                        payload={"model": "ci-deterministic-fixture",
                                 "messages": [{"role": "user", "content": message}]},
                    )
                    validate_upstream_response(response)
                    headers = {key.lower(): value for key, value in headers.items()}
                    receipt = headers.get("x-reef-agent-record-id")
                    if not receipt or not RECEIPT.fullmatch(receipt):
                        raise ValueError("Reef inference receipt unavailable")
                    reported, fheaders = request(
                        "/reef/report", token, scenario=scenario,
                        payload={"score": float(row[side]["score"]),
                                 "feedback": f"case={row['id']} side={side} observed={row[side]['status']}",
                                 "references": [receipt]},
                    )
                    fheaders = {key.lower(): value for key, value in fheaders.items()}
                    feedback = fheaders.get("x-reef-agent-record-id")
                    if not feedback and isinstance(reported, dict):
                        feedback = reported.get("agent_record_id")
                    if not feedback or not RECEIPT.fullmatch(feedback):
                        raise ValueError("Reef feedback receipt unavailable")
                    receipts.append({"caseId": row["id"], "variant": side,
                                     "inferenceReceipt": receipt, "feedbackReceipt": feedback,
                                     "observedScore": row[side]["score"]})
            releases, _ = request(f"/reef/scenarios/{scenario}/releases", token)
            count = len(releases.get("releases", [])) if isinstance(releases, dict) else 0
            return build_receipt_report(
                raw, base_sha=base_sha, head_sha=head_sha,
                reef_version=reef_version, receipts=receipts,
                trusted_evaluator=trusted, release_count=count,
            )
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=4)
        upstream.shutdown()
        upstream.server_close()
        log.unlink(missing_ok=True)


if __name__ == "__main__":
    result_path = ROOT / "artifacts" / "reef-paired-feedback.json"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        report = main()
        result_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({k: v for k, v in report.items()
                          if k not in ("receipts",)}))
    except Exception as error:
        result_path.write_text(json.dumps({
            "schema": "ultron.reef-paired-feedback.v1",
            "reefRuntimeVerified": False, "reefFeedbackVerified": False,
            "independentHeldoutCertified": False, "eligibleForMerge": False,
            "disposition": "BLOCKED_REEF_PAIRED_EVIDENCE_FAILED",
            "failureType": type(error).__name__,
        }, indent=2) + "\n", encoding="utf-8")
        print(f"Reef paired feedback failed: {type(error).__name__}: {error}",
              file=sys.stderr)
        sys.exit(1)
