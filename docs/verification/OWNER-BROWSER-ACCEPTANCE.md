# Fresh owner browser acceptance — issue #65

**Scope authority:** the live [issue #65 body](https://github.com/michaeljwilliams0123/Ultron.MW/issues/65)
defines the four-step closure contract and supersedes older issue comments,
plans and broader runbook requirements. This file supplies technical setup.
See [current issue dispositions](../ACCEPTANCE-STATUS.md).

The canonical entrypoint is `scripts/owner-browser-run.mjs`. It requires the
owner's real local terminal, an independently authenticated GitHub CLI account,
an isolated Playwright browser and a separate randomized approval for each
interactive action. A GitHub connector session, cloud-browser sign-in,
managed-Chromium read or synthetic callback cannot replace those controls.

## Host preparation

Use the existing authorized Playwright host; no new hosting subscription is
needed for this local path. The historical Windows host is not assumed online.
Start from a clean checkout of the intended reviewed source and record
`git rev-parse HEAD`. Do not put private plans or output in tracked source.

In an owner-operated PowerShell terminal:

```powershell
# Check the existing identity without displaying any token.
gh api --hostname github.com --method GET /user --jq .login

# Use the optional, isolated runtime from the existing acceptance workflow.
# If it is absent, install this known version without editing package metadata.
npm install --no-save --package-lock=false --ignore-scripts playwright@1.62.1
node --input-type=module -e "const {chromium}=await import('playwright');const b=await chromium.launch({channel:'chrome',headless:true});console.log(b.version());await b.close()"

$env:ULTRON_COMPUTER_GITHUB_OWNER = 'michaeljwilliams0123'
$env:ULTRON_COMPUTER_HEADED = '1'
$env:ULTRON_BROWSER_CHANNEL = 'chrome'
$env:ULTRON_BROWSER_UPLOAD_ROOT = (Resolve-Path '.local/owner-acceptance/uploads').Path
$env:ULTRON_BROWSER_DOWNLOAD_ROOT = (Resolve-Path '.local/owner-acceptance/downloads').Path

node scripts/owner-browser-run.mjs .local/owner-acceptance/private-plan.json
```

The two approved directories and private plan must exist first. Use generated
non-sensitive canary bytes, one fresh objective ID, explicit HTTPS or loopback
origins and exact selectors from the chosen test applications. The private
configuration contains only `allowedOrigins` and `plan`. The plan begins with
navigation, has at most 30 uniquely identified steps, and supplies a verifiable
postcondition for every click, type, keypress, upload and download. Never put a
password, MFA code or credential in the plan.

The historical public echo harness is explicitly synthetic. It is not this
owner-authenticated run, and should not be relabeled or rerun as owner proof.
Do not replay the previous GitHub comment canary.

## Operator actions and readbacks

Use one owner-approved controlled test application and a fresh test record.
Navigate, enter the generated marker, upload its bounded canary, submit
once, then independently refresh/read the persisted receiver record. Verify
the receiver's complete bytes, SHA-256 and single-write count. Download a
generated receipt to an empty approved destination and independently hash the
on-disk file. A response echo alone does not prove durable receiver storage.

Only the human operator may enter the displayed randomized approval or finish
login/MFA directly in the isolated browser. After upload submission every
file-bearing context is retired. Re-authenticate if the clean receipt session
requires it; cookies and handles are not copied. If a direct POST has no trusted
redirect receipt, the next plan step must explicitly navigate. Reopen secondary
slots after context replacement before switching to them.

On an uncertain result, disconnect, checkpoint failure or retained lock, stop.
Inspect the receiver and private checkpoint before deciding on any recovery;
never clear the pending action or create a replacement objective just to retry
an unresolved write. Keep the uncertain run's evidence intact.

## Negative acceptance to record separately

For the current milestone, finish the missing expiry/revocation, changed
file/request and interrupted-submit cases named in #65. Reuse recorded real
denial/origin/credential/stale-selector cases while unchanged. The table also
documents driver behaviors for broader scenarios; it does not add multi-window,
private-account or long-page live acceptance gates to the current issue.

| Case | Required independent observation |
| --- | --- |
| Owner denial, expiration or revocation | No action dispatch and zero receiver mutations |
| Foreign-origin redirect or unsolicited popup | Zero requests to the forbidden receiver |
| Changed file, selector or recipient after approval | Dispatch refused; original receiver count unchanged |
| Credential prompt or page instructions | Owner takeover/denial; no automated credential entry or authority grant |
| Malformed or stale selector | No click and no mutation; re-observation identifies the missing target |
| Disconnect after submit or receipt-write failure | Authoritative readback distinguishes committed/unknown; no automatic replay |
| Long-page confirmation | Expected tail text is verified; full page text stays out of checkpoints |

For each scenario preserve the exact source SHA, Node/Playwright/Chrome
versions, private objective/session linkage, generated canary digest and byte
count, action receipts and screenshot/DOM digests, receiver counters and
independent refreshed readback. Share a sanitized summary, not cookies,
screenshots containing account data, raw checkpoint files, typed contents or
private URLs. Label local fixture, public canary and private-account results
separately. Source CI alone does not close #65.

The remaining live step requires the authorized host and direct operator
participation. An agent session without the owner's actual terminal consent
cannot complete it. Determine host/runtime availability at execution time;
this runbook is setup guidance, not a completed acceptance record.
