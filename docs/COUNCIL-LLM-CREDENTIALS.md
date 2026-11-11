# Council debate LLM credentials: recommendation

**Status:** recommendation only. No secret, environment, workflow or variable
has been changed. Michael approved keeping the current setup "unless there is
a more advanced and efficient method" (Nov 10, 2026). This document covers that method.

## Today

`council-debate.yml` runs on `pull_request` (opened, synchronize, reopened). It
passes `GEMINI_API_KEY` and `GROQ_API_KEY` to the job with `issues: write`,
`pull-requests: write` and `id-token: write`. The job checks out trusted
`main`, which is good. However, a `pull_request` run uses the **workflow file from
the PR's merge ref**. Anyone who can push a branch to this repo can edit
`council-debate.yml` in that branch and read both keys. That includes the
owner, the Ultron bot account, Codex and Copilot agent branches (Copilot runs
need approval by default). The repository-level secrets are exposed to every
same-repo PR. The run then also posts with write scopes.

## Options

| Option | Keys exposed to PR branches? | Effort | Notes |
| --- | --- | --- | --- |
| A. Keep as is | **Yes** | none | Works. The blast radius is two free-tier keys plus PR-scoped write. |
| B. Environment-scoped secrets | No | small | Move the keys into an environment, e.g. `council-llm`, with deployment branches = `main` only. Since Nov 2025, GitHub evaluates environment rules for `pull_request` runs against `refs/pull/N/merge`, so a PR run can't reach the secrets, even with an edited workflow. Needs GitHub Pro for private repos, which Michael has. On its own this **stops LLM reasoning on PR events**, so pair it with C. |
| C. Split collect / reason via `workflow_run` | No | medium | The `pull_request` run stays deterministic and keyless. It uploads the title, body and diff summary as an artifact. A `workflow_run` workflow, which always runs main's workflow file with `GITHUB_REF` = main, uses the `council-llm` environment. It treats the artifact as untrusted data, calls the models and posts the report. This is GitHub Security Lab's recommended pattern. |
| D. GitHub Models (keyless) | **No keys at all** | small–medium | `permissions: models: read` lets `GITHUB_TOKEN` call `https://models.github.ai/inference/chat/completions`, an OpenAI-compatible endpoint ([changelog](https://github.blog/changelog/2025-04-14-github-actions-token-integration-now-generally-available-in-github-models/)). It has a free tier, which fits the "no paid fallback, ever" rule in `src/council-reasoning.mjs`. Add it as a third provider before the Gemini → Groq fallback. There's no key to leak or rotate. Rate limits apply, and paid usage stays opt-in and off. |
| E. Hatchable broker | No | larger | Hatchable keeps the keys. Actions exchanges its OIDC token, and `council-oidc.js` already pins `council-debate.yml@refs/heads/main`, so PR-ref tokens are refused. Hatchable makes the model call and returns only the verdict. This is the most central design, but it adds a Hatchable deploy and a runtime dependency. The current dispatch failure `hatchable-council-credential-exchange-failed:plan-invalid` would also need fixing first. |

## Recommendation

1. **Now (small, no behaviour loss):** add **D** (GitHub Models via `GITHUB_TOKEN`)
   as the primary provider for PR-event debates. Remove the two keys from the
   `pull_request` path, so PR runs use only the keyless provider and the
   deterministic fallback.
2. **Next:** move `GEMINI_API_KEY` and `GROQ_API_KEY` into a `council-llm`
   environment limited to `main` (**B**). Reach them only from main-context events:
   `/council` comments, the Continuum supervisor's dispatches, schedule, and a
   **C**-style `workflow_run` job for PR debates that need the stronger models.
3. **Later, optional:** make Hatchable the broker (**E**) once the credential
   exchange is healthy. Keys then never live in GitHub at all.

These steps also suit the self-repair loop: it needs no LLM keys, and any future
model-written diagnosis should use D.

Each step is a secret or permission change, so it needs Michael's explicit approval.
Tests in `test/council-reasoning.test.mjs` currently assert that the keys are wired in
`council-debate.yml`. That PR has to update those tests together with the workflow.
