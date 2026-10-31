# Native owner-browser execution — no Railway

**Current acceptance:** the live [issue #65](https://github.com/michaeljwilliams0123/Ultron.MW/issues/65)
body and final sanitized receipt record completed scoped acceptance for one
supervised controlled-app workflow and its required negative checks. See
[current dispositions](ACCEPTANCE-STATUS.md).
Earlier private-account, two-site, PC-offline and hosted-browser requirements
are outside this milestone; technical consent and no-replay checks remain.

**Scope:** A local owner-operated entry point to the existing Ultron computer
executor. GitHub Pages remains the current frontend while the accepted
[Repository Operator target](ULTRON-REPOSITORY-OPERATOR.md) awaits its gated
Hatchable cutover. GitHub Actions remains
CI, bounded PR work and on-demand jobs. No hosting changes or billing.

## Why this route

- Existing executor and Playwright adapter have mock regression coverage. A
  separately documented synthetic localhost Chrome smoke test already ran on
  Windows SD009WC7; see issue #65. This change does NOT repeat or upgrade that
  synthetic proof into authenticated production acceptance.
- GitHub Actions runners are ephemeral; they are not always-on processes,
  durable browsers or a substitute for owner sessions.
- Issue #66 is closed for bounded hosted recovery and owner stop. The browser
  remains PC-dependent; an authenticated Pages command bridge is separate work.
- No Railway, Cloudflare, Vercel or hosted browser is provisioned here.

## Owner preparation on an authorized local computer

1. Use Node.js 22+ in a local checkout. Keep all execution plans in a **private
   directory outside the repository**, never GitHub Issues/PRs or Pages.
2. Install optional Playwright only in the local checkout, without a committed
   package/lockfile change:

       npm install --no-save --package-lock=false --ignore-scripts playwright@1.62.1
       npx playwright install chromium

   **Windows alternative:** When Google Chrome is already installed, skip the
   Chromium binary download and opt in to Playwright's supported Chrome channel
   for this terminal session with `set ULTRON_BROWSER_CHANNEL=chrome` (CMD)
   or `$env:ULTRON_BROWSER_CHANNEL='chrome'` (PowerShell). Only the exact
   `chrome` value is admitted; arbitrary executable paths are rejected.

3. Create a private JSON plan file. A read-only public navigation example:

       {
         "allowedOrigins": ["https://example.com"],
         "plan": {
           "id": "read-public-example-01",
           "steps": [
             {
               "id": "open", "action": "navigate",
               "url": "https://example.com/",
               "expect": { "urlIncludes": "example.com" }
             },
             {
               "id": "verify", "action": "observe",
               "expect": { "textIncludes": "Example Domain" }
             }
           ]
         }
       }

4. From a **real interactive local terminal** (not CI, schedule, redirected
   standard input or browser console), set the matching GitHub CLI owner
   identity and run:

       set ULTRON_COMPUTER_GITHUB_OWNER=michaeljwilliams0123
       node scripts/owner-browser-run.mjs "C:\private\ultron-read-plan.json"

   To reproduce the completed #65 acceptance scope, also set
   `ULTRON_COMPUTER_HEADED=1` and the approved upload/download roots described in the
   [owner acceptance runbook](verification/OWNER-BROWSER-ACCEPTANCE.md).

5. Interactive click/type/keypress steps display plan ID, full fingerprint,
   origin, selector, assertion names (NOT assertion values), and, for
   typing, the length but NEVER the contents of the value. Expected matches
   can contain typed secrets, so their values are also always redacted. Enter the displayed per-step challenge.
   Incorrect entry, terminal closure or expiry denies the step. Approval
   does not carry forward to another action.
6. Inspect the receipt and independently refresh the target page if a write
   occurred. After the first successful transfer and readback, re-enter the
   same completed request and confirm that no second submission occurs. The
   receipt contains digests and action metadata, not cookies, passwords, typed
   values or screenshots. Local checkpoints live outside Git under the home
   directory's .ultron-mw/browser-checkpoints/ folder.

## Security, limitations and rollback

- A fresh isolated **headless** Playwright profile is launched by default.
  It never inherits Chrome cookies or tokens. To opt into manual GitHub login
  and MFA takeover in a **real interactive terminal**, set
  `ULTRON_COMPUTER_HEADED=1` (and `ULTRON_BROWSER_CHANNEL=chrome` if
  selecting installed Chrome). The owner types secrets directly into the
  isolated browser window; no agent or CLI receives credentials. The runner
  pauses with `owner-takeover-required`, accepts human `RESUME`, and
  requests a separate random per-step approval for any active action.
- The allowlist admits only explicitly stated HTTPS origins and loopback HTTP.
  Cross-origin resources and WebSockets are rejected. Hosted deployment would
  need additional network egress protections; none is authorized here.
- Existing executor semantics require owner callbacks and expected postconditions
  for active interactions. It checkpoints before potential writes, treats
  uncertain effects as requiring reconciliation, and will not replay them.
- CI indicators are denied before any approval, even when CI allocates a
  pseudo-terminal. Redirected input/output are also rejected. This is a
  fail-closed guard, not an unforgeable owner authentication mechanism.
- GitHub CLI `/user` proves the host's configured GitHub owner identity;
  the random terminal challenge proves separate local interactive consent.
  Neither alone proves a browser's external service sign-in. A real GitHub
  login form causes an owner-takeover stop; the owner must manually complete
  MFA before the browser can proceed when that private-account capability is
  used. Private-account takeover is outside the completed local-fixture #65
  milestone and requires separate acceptance.
- Press Ctrl+C, close the terminal, or decline the challenge to stop.
  If an effect is uncertain, inspect the destination before any retry.
- **New Chrome session checkpoint handling:** A stopped run may leave a
  checkpoint marking earlier navigation as complete even though a later
  invocation opens Chrome at `about:blank`. The owner runner preserves the
  old checkpoint and starts a fresh objective ID only when all previously
  completed steps were passive and there is no pending action. It never
  automatically restarts completed interactive actions or uncertain writes;
  those require owner reconciliation first.
- The owner's PC must stay on to execute this runner. PC-offline continuity is
  not available, and no zero-cost always-on hosting is claimed.
- Stopping this local runner leaves the separate GitHub and Hatchable lanes
  under their own controls.

## Completed acceptance and future scope

Issue #65 completed its four steps: owner-run setup, one generated canary
transfer with independently refreshed receiver/download digests and a
single-write count, expiry/revocation/changed-input/interruption cases, and a
sanitized evidence summary. Reuse that evidence only while relevant code and
configuration remain unchanged. Any future hosted browser, private-account
takeover or broader application scope requires a separate authorization and
acceptance decision.
