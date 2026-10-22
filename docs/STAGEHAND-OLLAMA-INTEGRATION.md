# Local Stagehand v4 + Ollama + SQLite compatibility bridge

**Status:** Optional source adapter, tested against real Chrome on a synthetic localhost site. This is not a production browser service or authenticated-owner handoff. Keep current GitHub Pages, PR brain, protected Verify, GitLab mirror and existing browser authority. PR #72 and PR #73 are parallel owner/browser projects; do not merge or replace them implicitly.

## Added contract (src/computer/stagehand-bridge.mjs)

- createStagehandPageDriver(page): translates supported Stagehand v4 browser methods into Ultron's existing createBoundComputerExecutor driver. It waits for Stagehand's asynchronous page.url(), unlike Playwright Page.url(). Supported actions: navigate, click, type, extract, observe, wait and scroll. Keypress, upload, desktop control are not admitted; fail closed until separately verified.
- createStagehandSelectorObserver({agent,page,allowedOrigins}): a model proposes selectors through agent.observe(). The adapter independently checks the exact allowed origin, candidate method, unique live DOM node, allowed tag and selector length. It never calls agent.act(), clicks, or approves an operation.
- createStagehandOllamaModel(localOllama): reuses src/providers/ollama.mjs for local-only inference at 127.0.0.1:11434. Admits bounded text requests only, refuses image/media messages, and returns a structured Stagehand response. This is not image-grounding or model training.
- createOptionalSqliteGraphCheckpointer({SqliteSaver,databasePath}): passes explicit local SQLite graph persistence to LangGraph.js, but does not replace Ultron's pending external-write checkpoint, per-objective lock, owner approval or action receipts.

No new production npm dependency, new privileged endpoint, provider account or workflow is introduced. All third-party libraries are optional and owner-installed in an isolated tool environment.

## Windows test bench

Device: SD009WC7. Separate local folder:
C:\Users\MikeWilliams\Ultron-External-Tools

Versions at evaluation: Stagehand 4.3.0, LangGraph.js 1.5.2, SQLite checkpoint 1.1.0, Ollama qwen3:8b, installed Chrome.

In that folder run:
- node integrated-ultron-bridge.mjs
- node multi-step-e2e.mjs negative
- node multi-step-e2e.mjs restart
- node sqlite-persistence.mjs verify
- npm.cmd audit --omit=dev --audit-level=high

The integrated-ultron-bridge.mjs test imports source directly from the separate feature checkout. It starts a local-only synthetic form, asks Ollama-backed Stagehand to find an input and Save button, checks real DOM uniqueness, then passes those selectors into createBoundComputerExecutor with a narrowly confined synthetic fixture authorization callback. Ultron types a fictional test value, submits exactly once, reopens the saved page and receives three verified receipts. A second execution of the identical objective resumes rather than sending another write.

Observed success on 2026-10-22: actual Chrome, 2 local model observations, 3 verified Ultron action receipts, 1 saved submission, local qwen3:8b, roughly 68.8 seconds for model inference plus actions. This test uses IN-MEMORY checkpointing within one process. The separate existing multi-step-e2e.mjs bench demonstrated file-store recovery across processes with no extra writes, and sqlite-persistence.mjs demonstrated a separate LangGraph SQLite checkpoint across processes. Do not conflate these independently verified scenarios.

## Required before production

1. Merge/coordinate PR #72 and PR #73 owner authentication and browser network redirect isolation. This adapter DOES NOT enforce network-level egress or revoke real sign-ins. Neither a model nor page content can generate an owner approval.
2. Stagehand v4 Page is NOT a Playwright Page. Stagehand locators do not provide locator.evaluate/getAttribute; the verified adapter uses page.evaluate to confirm the element and awaits page.url() explicitly.
3. The selector is a *proposal* only. Actual authority, origin rules, action type and postcondition remain Ultron's createBoundComputerExecutor responsibility.
4. The real account/browser session must require a separately authenticated operator, MFA takeover, real consent, external write validation and secure session storage. The test-only authorization callback must never be used on live sites.
5. Before allowing arbitrary websites, block forbidden redirects, private-network requests, WebSockets, popups and service workers at the browser/network boundary; pre/post URL matching is not enough.
6. Any LangGraph resume must not duplicate externally committed Ultron actions. Keep its graph store independent until lease and source-of-truth reconciliation has a separate acceptance suite.
7. Page text is adversarial input. Do not store credentials, screenshots, input contents or private business content in test checkpoints or public PR comments.
8. qwen3:8b is relatively slow, and a single synthetic test does not prove reliable general autonomy or business-safe judgment.

## Review and scope

- New code: one optional bridge module, six regression tests and this document.
- No changes to scripts/verify.mjs, existing API ports, CI protections, package.json, production deployment or current authentication.
- The full repository test script automatically discovers the added bridge tests.
- Other agent's issues and draft PRs are left intact; PR merge order should be decided after review of their independent action/identity and redirect security work.

**Remaining evidence:** an owner-authenticated external session with observed click/type/save, safe takeover and negative-case acceptance; durable multi-process/cloud lease; production-safe egress guard; and evaluated latency and model accuracy on unfamiliar tasks.

## Review hardening: long-page outcomes and changed targets

CodeRabbit identified that truncating browser observations at 10,000 characters
can hide a successful change near the end of a long page. The implementation
now keeps a bounded published observation (at most 10,000 characters), computes
a full-page text digest in memory, and adds a short excerpt of any requested
textIncludes assertion when it lies beyond the initial prefix. The existing
Ultron executor passes each step's expectation to the observer, compares the
full-page digests for changed-state detection, and binds the digest into its
receipt without persisting the entire page body.

The independent code review identified selector retargeting across DOM changes.
The Stagehand observer now keeps a short-lived, hashed snapshot of the target's
outer HTML plus exact document URL. For every interactive action, the driver
requires verifyTarget from the observer and checks the target fingerprint again
immediately before dispatch. A modified target, a different page, or a missing
verifier is rejected. A changed page requires a fresh AI observation.

The guard is conservative, not a formal race-free browser permission primitive:
a malicious page might mutate between the final check and the actual click or
replace a node with indistinguishable markup. Real account operation still needs
the separately authenticated owner-session permission flow, browser egress and
redirect isolation, application-specific outcome readback, and a revocable stop
control from PRs #72 and #73.

### Regression evidence

- A result located after the first 15,000 text characters is independently
  observable and satisfies the specified postcondition without storing all text.
- A tail-only change updates the full-page digest even if the displayed prefix
  is unchanged.
- A model-selected target modified after observation is denied before clicking.
- A target reused after a page change and any interactive driver lacking a
  verifier are denied.
- Four new tests augment the original six bridge tests.

Owner PC test harness:
C:\Users\MikeWilliams\Ultron-External-Tools\integrated-ultron-bridge.mjs

This test now passes the Stagehand observer's verifyTarget callback to the
Ultron driver. It performs model-selected, DOM-checked typing and clicking,
verifies one synthetic server-side form write, and confirms no duplicate.
It is not an authenticated SaaS session or evidence of production deployment.
