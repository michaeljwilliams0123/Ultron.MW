# Hatchable Model Lab — Hugging Face / GitHub Actions / Ultron

This is a **read-only, owner-authenticated control plane** for existing Hugging Face model evaluation and C06 model-authored PR workflows. It adds observability to the **one existing Hatchable UI**; it does not create or invoke model runners inside the Hatchable host.

## Data sources and truthful semantics

- Three fixed, public GitHub Actions workflow IDs are queried on demand: `hf-heldout-cpu.yml`, `hf-free-cpu-tournament.yml`, `c06-owner-model-release.yml`. Only the most recent `workflow_dispatch` run metadata is read; source commit SHA, run ID, status, conclusion and timestamp must pass strict validation. Failure and missing observations are not green.
- A **shared, owner-scoped PostgreSQL cache** (`hf_lab_cache`) holds only sanitized metadata, not tokens, model outputs or private prompts. The first owner fetch refreshes up to three public GitHub API URLs; subsequent reads reuse a 20-minute cache across browsers and MCP tools. A 45-second fenced lease prevents duplicate refreshes; when rate-limited, the server returns an explicitly stale or unavailable response and backs off for five minutes. No background polling.
- The recorded 8-job run [#41764422463](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/41764422463), source SHA `8530f25885dab764d4eb03fcf1bc76fb07c4487c`, corpus SHA `f544c3fc6366959d6def15bc1cb191ff583ee9bc73c284c10cbd1e4bb2817fdd`, produced fully behavior-correct synthetic repairs of **1/16, 1/16, 2/16 and 7/16** for four model profiles. These are **historical immutable evidence**, never the outcome of the latest run.
- The 3B Qwen research-license profile is restricted to **noncommercial evaluation**. Model comparison does not grant promotion or production permission. The 1.5B Apache-2.0 candidate remains behind protected C06 PR and exact-source acceptance.
- Live C06 source workflow is **not a successful model-generated production release**. A failed `generate` run can prevent its `publish` job and must be shown as failed/held, not treated as a green model pipeline.

## Owner channels

- Browser: `/api/brain/hf-lab` is access `admin` and uses same-origin authenticated requests. `public` gets 401, ordinary member 403. The Model Lab view is responsive and uses `textContent`, not HTML injection; no custom timers or browser-held GitHub secrets.
- MCP: `ultron_hf_lab` is an owner/admin OAuth tool that returns the **same bounded cached readback**. It cannot dispatch GitHub jobs, execute Hugging Face Jobs, change model choices or grant release authority.
- Existing native Hatchable realtime events may trigger a fresh **cached** readback on owner changes. This is not proof that direct GitHub/Hugging Face webhooks have been installed. Signed provider-webhook ingestion, immutable run artifacts, direct C06 run → task → protected PR → SHA deployment, independent promotion evidence and real browser owner acceptance remain separately tracked in [#170](https://github.com/michaeljwilliams0123/Ultron.MW/issues/170), [#194](https://github.com/michaeljwilliams0123/Ultron.MW/issues/194), [#245](https://github.com/michaeljwilliams0123/Ultron.MW/issues/245).

## Zero-paid capacity policy

Run model-heavy public, synthetic CPU tests on owner-dispatched GitHub standard runners, not inside the Hatchable HTTP request loop. Do not call Hugging Face Inference Providers, pay-as-you-go Jobs or upgraded hardware using production hosting credentials. The owner `$0` paid-spend ceiling remains unchanged.

Hugging Face currently documents a small free-user monthly Inference Providers credit **subject to change** and the possibility of paid usage beyond it, so a free credit is not a reliable production compute budget. The ZeroGPU free-user allowance is limited and requires eligibility/real quota checks; it is not interchangeable with existing ONNX GitHub CPU inference. Avoid attaching a permanent high-frequency webhook listener or repeatedly calling the anonymous GitHub REST API.

**Expected operational result:** actionable live workflow *status* without model compute in Hatchable, low API pressure, and a clear separation among historical evaluation evidence, new workflow outcomes and release eligibility.
