# GitHub → Hatchable signed Hugging Face workflow receipts

## Current deployment scope and remaining external activation

The Hatchable server implements GitHub **native workflow_run HMAC-SHA256** verification on `POST /api/brain/github-workflow-webhook`. It is a separate protocol from the custom signed `/api/brain/events` bridge and does **not** accept that bridge's HMAC format.

**One-time external credential setup is required before declaring provider delivery live**:

1. In the owner Hatchable project's secret settings, provide `ULTRON_HF_GITHUB_WEBHOOK_SECRET`, a newly generated, high-entropy string of at least 32 unpredictable bytes. Keep it distinct from `ULTRON_EVENT_BRIDGE_HMAC_KEY`.
2. In the GitHub repository's **Settings → Webhooks → Add webhook**, set payload URL `https://ultron-mw-cloud.hatchable.site/api/brain/github-workflow-webhook`, content type `application/json`, HTTPS verification enabled, and **the exact same secret**. Select only `Workflow runs` events. This is not permission to enroll other repositories or to expose the secret in a PR or chat.
3. Verify GitHub's initial ping and an actual completed `workflow_dispatch` event. Fetch the GitHub delivery receipt, its request/response status, and the matching `hf_github_receipts` row. Confirm duplicate redelivery returns the same receipt without recreating work; invalid signatures 403; unsupported repository/workflow/branch 422.
4. Wait for the separately authorized Hatchable scheduler worker `/api/brain/hf-github-reconcile` to read back the exact GitHub run and artifact metadata independently. The native `ultron.owner` event causes an owner Model Lab reread. If immediate work cannot be scheduled, the existing hourly `/api/brain/tick` recovers due receipts.

**Do not create an unsigned live webhook**, or add a webhook with its secret absent on either side. The route returns 503 when the secret is unconfigured. A new operator token, GitHub administration or account impersonation is not needed to read the existing data; installing the webhook itself requires GitHub repository admin rights.

## Source and evidence contract

Accepted GitHub events must satisfy all of the following, even **after** valid HMAC authentication: repository exactly `michaeljwilliams0123/Ultron.MW` and public; owner actor; `workflow_dispatch`; branch `main`; action/status `completed`; valid 40-hex source SHA, integer run ID and attempt; a recognized conclusion; and one of three exact allowlisted workflow paths:

- `.github/workflows/hf-heldout-cpu.yml`
- `.github/workflows/hf-free-cpu-tournament.yml`
- `.github/workflows/c06-owner-model-release.yml`

The HMAC is verified against **`req.rawBody`** and `X-Hub-Signature-256` through Hatchable `webhooks.verifyHmac`. `X-GitHub-Delivery` is the unique identifier; the database also uniquely keys `(run_id,run_attempt)`. A re-delivery only acknowledges the original receipt and never dispatches another model job. The handler writes no code, PR, branch, credential or paid provider request. Only bounded numeric and hash metadata is persisted.

The separate scheduler route reads the canonical GitHub `GET /actions/runs/{id}` and the associated artifact metadata using read-only HTTP. It compares repository, actor, exact workflow path, attempt, branch, source SHA and conclusion with the signed receipt, and stores a bounded list of artifact IDs, safe names, sizes and API-supplied SHA-256 digests. This **does not download or hash ZIP bytes**: it is independently reconciled **metadata** evidence, not end-to-end artifact content attestation. GitHub API errors or mismatch cause retry/hold and **never** fabricate a successful repair, paid-budget claim or production promotion. Bounded retries: 3, with 15-minute backoff and hourly recovery. Fencing token prevents late workers from superseding a newer receipt update.

The existing owner-authenticated `GET /api/brain/hf-lab` and the `ultron_hf_lab` MCP tool now overlay **only independently reconciled** receipts onto their bounded GitHub status cache, without waiting for the 20-minute refresh. The UI labels these as signed-delivery/independent-GitHub-readback, not as promoted models. Raw private code, prompts and tokens never enter the realtime channel.

## Validation / rollout criteria

- Test-only RED→GREEN CI covers allowed vs forged repository/actor/workflow/source, replay conflict, independent provider mismatch, artifacts name and digest shape, and research-license nonpromotion.
- Hatchable migration adds `hf_github_receipts` without altering existing project authority or credentials. Admin-only readback, anonymous/member denials, and the public HMAC-route absent-secret and invalid-signature behaviors must be exercised after deployment.
- The **positive** signed-provider delivery and 2-tab live owner session cannot be claimed before matching secrets are installed and GitHub proves a real delivery ID. Keep issue #269 open until observed.
- C06 issue #245 continues to require a truly model-generated multi-file protected PR, exact-head CI and merge, byte-exact Hatchable deployment and independent runtime postcondition. A signed workflow **failure** stays failure. No automatic model promotion or fallback to charged compute.
- Free Hugging Face ZeroGPU authorization remains held under #248; this work uses no Hugging Face Jobs, paid Inference Providers or GPU runner.

### Operational source links
GitHub repository: https://github.com/michaeljwilliams0123/Ultron.MW
Hatchable project: https://hatchable.com/console/projects/ultron-mw-cloud
Accepted owner UI: https://ultron-mw-cloud.hatchable.site
Issue: https://github.com/michaeljwilliams0123/Ultron.MW/issues/269
