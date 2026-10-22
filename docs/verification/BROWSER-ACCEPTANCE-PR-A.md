# PR A — Browser execution acceptance (issues #65 and #32)

## Scope and evidence boundary

This change augments the merged PR #64 foundation. It keeps GitHub Pages,
GitHub Actions, source protection, and existing routing unchanged. It does not
deploy a browser service, add a paid provider, reuse an existing browser profile,
or claim an external login or owner-authenticated browser session.

The fixture acceptance runs actual installed Chrome via optional Playwright
on two ephemeral **loopback** origins. The callback that approves fixture
actions is explicitly synthetic and must never be used for external sites.
The user-operated CLI continues to require a local per-step challenge. A TTY
indicates an interactive local operator, NOT an authenticated third-party owner.

## How to reproduce on an authorized Windows test machine

From a clean isolated checkout:

```powershell
npm.cmd install --no-save --package-lock=false --ignore-scripts playwright
node --test test/computer-executor.test.mjs test/computer-bindings.test.mjs test/computer-session.test.mjs test/computer-owner-verifier.test.mjs
node scripts/computer-browser-acceptance.mjs --synthetic
$env:ULTRON_COMPUTER_GITHUB_OWNER='michaeljwilliams0123'
node scripts/computer-external-github-acceptance.mjs --read-only
node scripts/verify.mjs
```

The optional `playwright` package and installed Chrome are host prerequisites,
not changes to the project's committed dependencies or lockfile. System Chrome
is selected explicitly (`channel: 'chrome'`), not a privileged existing profile.
The existing local owner-operated script can select system Chrome using
`ULTRON_BROWSER_CHANNEL=chrome`; it still requires every action's TTY approval.
It also requires `ULTRON_COMPUTER_GITHUB_OWNER` to match the authenticated
GitHub CLI `/user` identity before launching the browser; a credential never
enters the browser context. For owner takeover set
`ULTRON_COMPUTER_HEADED=1` in a real interactive terminal. The operator must
sign in/MFA **directly in that new isolated Chrome window**, then type
`RESUME` in the terminal. No OTP/password is ever requested by this CLI.
A non-destructive, owner-only GitHub login/click example is checked in at
`docs/verification/GITHUB-OWNER-LOGIN-ACCEPTANCE.example.json`:

```powershell
$env:ULTRON_COMPUTER_GITHUB_OWNER='michaeljwilliams0123'
$env:ULTRON_BROWSER_CHANNEL='chrome'
$env:ULTRON_COMPUTER_HEADED='1'
$planDir = Join-Path $HOME '.ultron-mw\plans'
New-Item -ItemType Directory -Force $planDir | Out-Null
$planPath = Join-Path $planDir 'github-owner-login-acceptance.json'
Copy-Item docs/verification/GITHUB-OWNER-LOGIN-ACCEPTANCE.example.json $planPath
node scripts/owner-browser-run.mjs $planPath
```

Run only in an interactive terminal on the owner's Windows desktop.

**Checkpoint / new-browser recovery:** Every invocation creates a fresh Chrome
context, which cannot inherit pages or GitHub login from a previous session.
If a previous attempt recorded only completed read-only steps and has no
pending action, the owner runner retains those receipts and **durably links**
a fresh objective ID to the original plan before launching Chrome. Its root
objective lock remains held across login/MFA, every owner approval and the
final readback. On later invocations it inspects the entire linked attempt
history; if any linked attempt contains a completed click/type/keypress,
pending action or uncertain write, the runner **refuses automatic restart**
and requires explicit reconciliation. Only all-passive attempts can restart
from the first navigation in a new isolated browser. A cryptographic suffix
contains 16 hexadecimal characters, without UUID hyphens. No checkpoint
evidence is deleted or silently overwritten, and a previously reserved
but unstarted attempt ID is reused. This prevents old completed navigation
from leaving a new browser at `about:blank` and reporting `Browser origin
not admitted`, while also preventing repeated owner-approved actions.

The canonical owner runner (merged PR #73) now combines its independent local
random challenge with the real GitHub CLI host identity check. Manual
login/MFA happens directly in the isolated Chrome window; the CLI asks the
owner to `RESUME` after completion and then asks `APPROVE` for its
read-only click. If the GitHub settings selector changed, the action fails
closed and must be inspected rather than guessed. This **example has not
been executed with real user authentication**.

## Acceptance matrix

| Assertion | Validation | Evidence status |
| --- | --- | --- |
| Two distinct loopback origins | Real Chrome navigates fixture A and B | Local synthetic proof |
| Type and click with post-action readback | Fixture form save and independently fetched state | Local synthetic proof |
| Crash-safe idempotency | Rerun same objective, one external write | Local synthetic proof |
| Visual observation | SHA-256 of real screenshot and accessibility snapshot in each receipt | Local synthetic proof; hashes, not image interpretation |
| Redirect isolation/fail-closed | All 3xx responses are blocked, including allowed-origin redirects; no rewrite of browser-visible URL/history is claimed | Unit regression and real Chrome synthetic proof |
| Ambiguous disconnect | Browser closes just after actual submit; objective requires reconciliation; repeated run makes no second write | Local synthetic proof |
| Owner session bounds | Independent injected verification callback, expiration, revocation, origin and approval cap | Unit tests; separate GitHub CLI host identity now verified |
| Session stop during observation/checkpoint | Revocation denies subsequent passive navigation; a pending checkpoint becomes reconciliation-required without dispatch or replay | Unit tests; no external identity connected |
| Authenticated GitHub **host** identity | GitHub CLI `/user` matches configured repository owner; remote PR head read back from GitHub API | **Proven on SD009WC7**, not browser SSO |
| Live external GitHub browser observation | Isolated Chrome opens public PR #72, verifies title and produces two action receipts | **Proven read-only**, no external write |
| Credential/MFA takeover detection | Live GitHub `/login` stops before simulated credential typing | **Proven as a safe stop**, no owner sign-in or real MFA completion |
| Actual browser SSO, MFA completion and independent human approval | Requires owner to authenticate in an isolated headed browser and approve actions through the local TTY | **Not proven** |
| Screenshot-driven semantic visual reasoning and session persistence across devices | Requires separately accepted implementation and redaction policy | **Not proven** |
| Production GitHub Pages dispatch and saved authenticated GitHub receipt | End-user session validation and current-main workflow evidence | **Not proven by this fixture** |

## Security boundaries

- `route.continue()` or fulfilling a 3xx lets Chromium follow redirects
  without rechecking destination origins. Resolving hops through the API
  context and fulfilling a final 200 body instead leaves Chromium's original
  POST URL in browser history and receipts, risking refresh/resubmission.
  **All 3xx responses are now blocked**, including redirects to allowed
  origins. No API follow-up request is made. A redirected original write
  might still have reached the first server and must be reconciled rather
  than replayed. Non-redirect final responses can still be fulfilled.
  Redirect compatibility requires browser-native correct destination/history
  semantics, isolation on every hop, and an egress boundary before release.
- WebSockets and popups remain closed; service workers remain blocked.
- Screenshot buffers and accessibility snapshots are hashed **in memory**;
  their raw bytes/text are not included in durable checkpoints or test receipts.
  The DOM text is used in volatile verification and its digest is persisted.
- The injected `verifyOwner` callback **must be implemented by a trusted,
  authenticated host**; arbitrary webpage JS or an LLM cannot be a verifier.
- The local console runner is a bounded, interactive operator tool, not SSO.
- `canContinue` is checked before/after observation and before dispatch of
  **all** actions, including navigation. On expiry or revocation, no new step
  is dispatched. If the session ends after a pending checkpoint is saved, the
  worker conservatively requires reconciliation instead of replay.
- An action already in flight at revocation may have executed. Its unverified
  outcome remains `reconcile-required`; it cannot be silently replayed.
- Application-layer allowlists are not protection against DNS rebinding or
  arbitrary private-network access in a hosted runtime. Add network-level
  egress controls before expanding beyond approved local testing.

## Independent read-only Pages smoke

Using a **fresh, cookie-free Chrome context** against the existing public Pages
deployment (not the draft PR), the Brain, Learning and Systems tabs were
clicked and verified at desktop (1280 × 760) and mobile (390 × 844) viewports.
Both document navigations returned HTTP 200 with zero observed page errors.
Screenshots were hashed only in memory, not saved or published. This is
unprivileged UI rendering/navigation evidence; it does **not** establish
authenticated GitHub dispatch, live browser owner approval, or the PR's
unmerged code running in production.


## Real owner-approved click — unresolved outcome (October 22, 2026)

An owner-operated, headed Chrome session reached GitHub's own account
settings after manual `RESUME`. The terminal presented a one-time
`APPROVE` challenge for a read-only email-settings link. The owner
entered the correct challenge. The runner recorded the first two
navigation receipts as verified, but the click produced:

- `status: reconcile-required`
- `pending: owner-approves-readonly-click`
- `errorCode: outcome-unverified`

**This is evidence of actual operator authorization, NOT evidence of the
click executing or of the expected destination being verified.** A click
may have happened before Playwright timed out or the navigation/receipt
check failed. The original checkpoint and root/child lineage must stay
unchanged; **never delete the checkpoint or replay the click**.

The previous runner collapsed all exceptions after action dispatch into a
single generic result, so the original failure phase cannot be recovered.
A later source-of-truth page readback may help reconcile the current
application state, but cannot prove what happened during the closed session.

### Diagnostic hardening for subsequent NEW, explicitly approved objectives

1. For clicks, the Playwright adapter first performs `click({trial:true})`
   to verify target actionability *without clicking*. If it fails, the
   executor returns `action-not-ready` before prompting for owner approval,
   without creating a pending action.
2. An uncertain dispatched action stays `reconcile-required`. Its local
   checkpoint now includes a small allowlisted failure phase/category, a
   bounded URL pathname (no query string or fragment) when observable, and
   a screenshot digest only. Error text, cookies, page content, screenshots,
   and typed values are never persisted by the diagnostics.
3. If observation after a timed-out click succeeds, the observed pathname
   is contextual evidence, **not a successful action receipt**. The owner
   must still reconcile the result.
4. Synthetic tests cover missing targets, an actual Playwright trial
   in installed Chrome, a timed-out click whose observable URL changed,
   unchanged postconditions, and refusal to replay an uncertain write.

This hardening does NOT retroactively turn the failed user-run acceptance
into success. The owner-authenticated end-to-end click receipt remains
outstanding, as does the independent CodeRabbit redirect/navigation
finding. Keep PR #72 unmerged until reconciled and reviewed.

## Release boundary

Draft PR only. Do not merge on test-green alone. Issues #65 and #32 must stay
open until external owner-authenticated acceptance, actual approved browser UI,
negative-path gate and source-of-truth receipts have been witnessed.
