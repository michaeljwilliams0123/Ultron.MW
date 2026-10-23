# Browser P1 — file-transfer and bounded multi-tab acceptance

## Release boundary

This change is stacked on PR #72's accepted owner-browser source; it is not
deployed, merged into main, or evidence of an external authenticated write.
Existing owner checkpoints remain untouched. Upload/download actions are
explicitly higher-risk interactions and require the same randomized, local
per-action console challenge as clicks or typing. CI cannot supply approval.

## New actions

- `tab-open`: open one of the preallocated `secondary` or `tertiary` tabs
  at an explicitly allowlisted URL, then use it as the observed page.
- `tab-switch`: select a previously navigated `primary`, `secondary` or
  `tertiary` tab. Unopened tabs are rejected.
- `tab-close`: close a nonprimary tab and return to the primary page.
- `upload`: after owner approval, select exactly one nonempty regular file
  from an explicitly configured upload directory (maximum 8 MiB).
  Before and after approval, recheck the canonical file, size and SHA-256.
  Playwright reports selected file metadata, never its contents.
- `download`: after owner approval, click an approved target and capture
  the actual Playwright download event. Stream at most 8 MiB to an exclusive
  filename in an explicitly configured download directory. Read the resulting
  file back and verify byte count and SHA-256 before producing a receipt.

Filename and target restrictions are validated before owner consent. A
download never overwrites an existing file; failed partial writes are cleaned
up only when this operation created them. Refused or ambiguous dispatches
remain reconciliation-required without blind retries.

## Opt-in operator settings

The owner may use the existing `scripts/owner-browser-run.mjs` with a private
action plan; do not commit a real private plan or input file.

```powershell
$env:ULTRON_COMPUTER_GITHUB_OWNER = 'michaeljwilliams0123'
$env:ULTRON_BROWSER_CHANNEL = 'chrome'
$env:ULTRON_COMPUTER_HEADED = '1'
$env:ULTRON_BROWSER_MULTITAB = '1'
$env:ULTRON_BROWSER_UPLOAD_ROOT = 'C:\OwnerApproved\UltronUploads'
$env:ULTRON_BROWSER_DOWNLOAD_ROOT = 'C:\OwnerApproved\UltronDownloads'
node scripts/owner-browser-run.mjs C:\OwnerApproved\plans\private-plan.json
```

The upload and download roots must exist and be real directories, not
symbolic-link roots. The browser stays isolated, with service workers blocked,
out-of-allowlist origins rejected and unsolicited popup tabs closed.
Preallocated tabs share the isolated browser context; these are **browser
tabs**, not independent operating-system windows or accounts.

## Acceptance and evidence

Run `node --test test/computer-tabs.test.mjs
test/computer-file-transfer.test.mjs` and `node scripts/verify.mjs`.
These tests cover action normalization, tab isolation/selection/close,
out-of-root files, bounded filenames, byte/digest checks, file-input dispatch,
exclusive download creation and refusal to overwrite.

**Not established by unit tests:** Chrome-backed actual upload/download,
real external authenticated write and independent application readback,
automatic recovery after a real interrupted download, or the full multi-window
desktop lifecycle. An input's selected-file receipt does not prove that a
remote server received or durably stored those bytes. Keep #65 open for these
acceptance operations.

Windows on SD009WC7 does not permit creating symbolic links without an
elevated privilege. The symlink-negative test exercises the rejection where
supported but records that limitation instead of silently claiming a pass.
No OS privilege/security setting was changed to make this test pass.

## Explicitly excluded

No GitHub App was installed, no protected key was provisioned, no model or paid
API call was made, no Hatchable deployment changed, and no Pages UI bridge was
promoted. PR #76 retains its independent production-parity hold.
