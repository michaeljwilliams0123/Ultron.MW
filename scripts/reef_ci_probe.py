"""Ephemeral, zero-paid-provider Reef protocol probe for GitHub Actions.

This starts a real Reef runtime using a deterministic loopback-only fixture as
its upstream OpenAI-compatible endpoint. It validates serving, receipts,
feedback reporting, and release visibility. It is NOT a candidate evaluation
or evidence that Ultron learned or improved.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
from pathlib import Path

FIXTURE = "REEF_CI_FIXTURE_OK"
REPO_SHA = re.compile(r"^[0-9a-f]{40}$")
RECORD_ID = re.compile(r"^[A-Za-z0-9_.:-]{8,128}$")
ROOT = Path(__file__).resolve().parent.parent
PORT_UPSTREAM = 19090
PORT_REEF = 19091
BASE = f"http://127.0.0.1:{PORT_REEF}"


def build_report(*, source_sha: str, reef_version: str,
                 inference_receipt: str, feedback_receipt: str,
                 release_count: int) -> dict:
    """Never let a transport smoke probe be mistaken for candidate selection."""
    if (
        not REPO_SHA.fullmatch(source_sha)
        or not isinstance(reef_version, str) or not reef_version.strip()
        or not isinstance(inference_receipt, str)
        or not RECORD_ID.fullmatch(inference_receipt)
        or not isinstance(feedback_receipt, str)
        or not RECORD_ID.fullmatch(feedback_receipt)
        or not isinstance(release_count, int) or release_count < 1
    ):
        raise ValueError("Missing independently checked Reef runtime receipt")
    return {
        "schema": "ultron.reef-runtime-probe.v1",
        "sourceSha": source_sha,
        "runtime": "reef-infra",
        "version": reef_version,
        "runtimeVerified": True,
        "inferenceReceipt": inference_receipt,
        "feedbackReceipt": feedback_receipt,
        "feedbackVerified": True,
        "releaseCount": release_count,
        "upstream": "loopback-deterministic-fixture",
        "upstreamResponseSha256": hashlib.sha256(FIXTURE.encode()).hexdigest(),
        "costUsd": 0,
        "candidateEvaluated": False,
        "heldoutCertified": False,
        "eligibleForMerge": False,
        "disposition": "INCONCLUSIVE_CANDIDATE_NOT_EVALUATED",
    }


def validate_upstream_response(payload: object) -> bool:
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, TypeError, IndexError):
        raise ValueError("Reef inference response missing message content") from None
    if content != FIXTURE:
        raise ValueError("Reef inference response did not match the fixed marker")
    return True


class FixtureHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        if self.path not in ("/v1/chat/completions", "/chat/completions"):
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 2 or length > 65536:
                raise ValueError("Invalid fixture body length")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body.get("messages"), list):
                raise ValueError("No messages in test inference")
        except (ValueError, json.JSONDecodeError, TypeError):
            self.send_error(400)
            return
        response = {
            "id": "chatcmpl-reef-ultron-smoke",
            "object": "chat.completion",
            "created": 1,
            "model": "ci-deterministic-fixture",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": FIXTURE},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        }
        data = json.dumps(response).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args) -> None:
        pass


def request(path: str, token: str, *, payload: dict | None = None,
            scenario: str | None = None) -> tuple[object, dict]:
    headers = {"Authorization": "Bearer " + token}
    if scenario:
        headers["x-reef-scenario"] = scenario
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode()
    req = urllib.request.Request(
        BASE + path, data=data, headers=headers,
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.load(res), dict(res.headers.items())


def run() -> dict:
    source_sha = os.environ.get("ULTRON_SOURCE_SHA", "")
    if not REPO_SHA.fullmatch(source_sha):
        raise ValueError("Exact source SHA required")
    reef_version = version("reef-infra")
    token = secrets.token_hex(20)
    upstream = ThreadingHTTPServer(("127.0.0.1", PORT_UPSTREAM), FixtureHandler)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    log_path = ROOT / "artifacts" / "reef-local-runtime.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "reef", "serve",
        "--inference.upstream-url", f"http://127.0.0.1:{PORT_UPSTREAM}",
        "--inference.upstream-model", "ci-deterministic-fixture",
        "--reef.port", str(PORT_REEF),
    ]
    process = None
    try:
        env = {**os.environ, "REEF_TOKEN": token, "REEF_UPSTREAM_API_KEY": "ci-fixture"}
        with log_path.open("w", encoding="utf-8") as stream:
            process = subprocess.Popen(
                cmd, cwd=ROOT, env=env, stdout=stream,
                stderr=subprocess.STDOUT, text=True,
            )
            ready = False
            for _attempt in range(90):
                if process.poll() is not None:
                    raise RuntimeError("Reef exited before HTTP readiness")
                try:
                    health, _ = request("/healthz", token)
                    if isinstance(health, dict) and health.get("ok") is True:
                        ready = True
                        break
                except (urllib.error.URLError, TimeoutError, OSError):
                    time.sleep(1)
            if not ready:
                raise RuntimeError("Reef did not become HTTP-ready")
            scenario = "ultron-reef-runtime-smoke"
            inference, headers = request(
                "/v1/chat/completions", token, scenario=scenario,
                payload={
                    "model": "ci-deterministic-fixture",
                    "messages": [{"role": "user", "content": "Return the CI fixture marker"}],
                },
            )
            validate_upstream_response(inference)
            lowercase = {key.lower(): value for key, value in headers.items()}
            receipt = lowercase.get("x-reef-agent-record-id")
            if not receipt:
                raise ValueError("Reef response contains no persisted inference receipt")
            _feedback, f_headers = request(
                "/reef/report", token,
                payload={
                    "score": 1.0,
                    "feedback": "loopback fixture protocol matched",
                    "references": [receipt],
                },
                scenario=scenario,
            )
            feedback_headers = {k.lower(): v for k, v in f_headers.items()}
            feedback_receipt = feedback_headers.get("x-reef-agent-record-id")
            if not feedback_receipt and isinstance(_feedback, dict):
                feedback_receipt = _feedback.get("agent_record_id")
            release_response, _ = request(
                f"/reef/scenarios/{scenario}/releases", token,
            )
            releases = release_response.get("releases") if isinstance(release_response, dict) else None
            return build_report(
                source_sha=source_sha, reef_version=reef_version,
                inference_receipt=receipt,
                feedback_receipt=feedback_receipt,
                release_count=len(releases) if isinstance(releases, list) else 0,
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
        # Delete raw logs: no inference payload or transient runtime data should
        # leave the ephemeral CI machine. A failure remains visible in job logs.
        log_path.unlink(missing_ok=True)


if __name__ == "__main__":
    path = ROOT / "artifacts" / "reef-runtime-probe.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        result = run()
        path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result))
    except Exception as exc:
        path.write_text(json.dumps({
            "schema": "ultron.reef-runtime-probe.v1",
            "runtimeVerified": False, "feedbackVerified": False,
            "candidateEvaluated": False, "eligibleForMerge": False,
            "disposition": "BLOCKED_RUNTIME_PROBE_FAILED",
            "failureType": type(exc).__name__,
        }, indent=2) + "\n", encoding="utf-8")
        print(f"Reef protocol probe failed ({type(exc).__name__}): {exc}", file=sys.stderr)
        sys.exit(1)
