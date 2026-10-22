# Native owner-browser execution — no Railway

**Scope:** A local owner-operated entry point to the existing Ultron computer
executor. GitHub Pages remains the single frontend. GitHub Actions remains
CI, bounded PR work and on-demand jobs. No hosting changes or billing.

## Why this route

- Existing executor and Playwright adapter have mock regression coverage. A
  separately documented synthetic localhost Chrome smoke test already ran on
  Windows SD009WC7; see issue #65. This change does NOT repeat or upgrade that
  synthetic proof into authenticated production acceptance.
- GitHub Actions runners are ephemeral; they are not always-on processes,
  durable browsers or a substitute for owner sessions.
- Issue #66 remains open for PC-offline operation, persistent hosted leases,
  authenticated Pages-to-runtime transport, MFA and production readback.
- No Railway, Cloudflare, Vercel or hosted browser is provisioned here.

## Owner preparation on an authorized local computer

1. Use Node.js 22+ in a local checkout. Keep all execution plans in a **private
   directory outside the repository**, never GitHub Issues/PRs or Pages.
2. Install optional Playwright only in the local checkout, without a committed
   package/lockfile change:

       npm install --no-save --package-lock=false playwright
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

5. Interactive click/type/keypress steps display plan ID, full fingerprint,
   origin, selector, assertion names (NOT assertion values), and, for
   typing, the length but NEVER the contents of the value. Expected matches
   can contain typed secrets, so their values are also always redacted. Enter the displayed per-step challenge.
   Incorrect entry, terminal closure or expiry denies the step. Approval
   does not carry forward to another action.
6. Inspect the receipt and independently refresh the target page if a write
   occurred. The receipt contains digests and action metadata, not cookies,
   passwords, typed values or screenshots. Local checkpoints live outside
   Git under the home directory's .ultron-mw/browser-checkpoints/ folder.

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
  MFA before the browser can proceed. The actual user-authenticated takeover
  run remains pending; do not mark issue #65 complete.
- Press Ctrl+C, close the terminal, or decline the challenge to stop.
  If an effect is uncertain, inspect the destination before any retry.
- The owner's PC must stay on to execute this runner. PC-offline continuity is
  not available, and no zero-cost always-on hosting is claimed.
- Removing this draft PR/runner leaves Pages, GitLab recovery, protected main,
  Verify, and the existing executor unchanged.

## Open acceptance: issues #65 and #66

Still required: owner-authenticated session, browser takeover/MFA pause,
visual screenshot/DOM grounding, real authorized post-submit readback, external
redirect/credential-prompt negatives, disconnect-mid-write reconciliation,
reliable owner kill switch and durable PC-offline runtime if required.
Choosing a hosted service requires a separate pricing and authorization decision.
