# Council Room front door (Companion-first)

Owner decision (Nov 10, 2026): the Council Room is the single front door to
Ultron, and Companion is its lead voice. This change is additive. Existing
pages, routes and the Council's seven-member replies keep working.

## What changes for the owner

| Surface | Before | After |
| --- | --- | --- |
| `/council-room.html` signed out | "Council room unavailable: login_required", no way forward | A **Sign in with Hatchable** card built from the API's own `login_url` (only `https://*.hatchable.com` is accepted) that returns to the Council Room |
| `/council-room.html` signed in as a non-owner | Same error | "Signed in, but not as the owner" card |
| Thread | Seven role replies, Companion last | **Companion replies first** with a plain-language summary, then the members, then the summary |
| Consequential asks (merge, release, deploy, spend, permissions, secrets, outside messages, repo settings) | Text only | **In-thread approval cards** with Approve / Decline |
| `/` nav | Council room third | "Council room · start here" first |
| Workspace and GitHub Pages console | "Send to Ultron" opens a GitHub task only | Adds **Ask the Council instead**: carries the typed text as a *draft* (URL fragment, never sent to a server) into the Council Room composer. It is never auto-sent. |
| Nav links to pages the deployment doesn't serve | 404 | `nav-guard.js` marks them "(not deployed)" instead of linking to a dead end |

## Approval cards: what a click means

* The Council can only **request** a decision. A card carries
  `executes:false` and `countsAsApproval:false`.
* Typing "approve" (or anything) in the composer does nothing. Chat posts never
  write a decision.
* The owner's click on a card calls `POST /api/brain/council-room-approval`
  (admin + owner handle + same-origin). The server re-reads the stored Council
  result, re-derives the card id from the task key and operation, and records
  one write-once decision in `council_room_approvals` (migration `0042`,
  append-only trigger, `executes` constrained to `FALSE`).
* An approval is recorded owner intent. It does not run the operation. Merges,
  deploys, secret changes and other owner-only operations still go through
  their existing governed path (GitHub UI, signed grants, etc.).

## The two "404" nav links

`repair-operations.html` and `github-pr-comment-canary.html` exist in source
(`cloud/hatchable/public/`) and have tests, so they were kept. They 404 live
because the deployed Hatchable site is not the current source. They resolve
once the public files are deployed. Until then, `nav-guard.js` labels them.

**Drift warning:** the live site also serves `local-workbooks.html` and a
`connectors.html` link that are **not** in `main`. A full deploy of
`cloud/hatchable/public/` from this branch could drop them. Reconcile that
first (commit the live files to source or confirm they should go).

## Deploy steps (owner)

1. Merge this PR after review.
2. Deploy the Hatchable **static and API files only**:
   `public/council-room.{html,js,css}`, `public/index.html`,
   `public/workspace.html`, `public/nav-guard.js`,
   `public/council-front-door.js`, `public/repair-operations.{html,js}`,
   `public/github-pr-comment-canary.{html,js}`,
   `lib/council-front-door.js`, `lib/council-room-core.js`,
   `api/brain/council-room.js`, `api/brain/council-room-approval.js`.
   Without migration `0042` the room works and cards show "decision recording
   is not set up on this deployment yet". Nothing is executed either way.
3. Apply `migrations/0042_council_room_approvals.sql` **only after** the
   migration-ledger reconciliation described in `cloud/hatchable/README.md`
   (production was observed through `0028`). `0042` depends only on
   `brain_tasks` (`0001`) and alters no existing table, but Hatchable applies
   pending migrations in order.
4. Read back: signed out, `/council-room.html` shows the sign-in card; signed in,
   send "Merge PR 999 once checks pass." and confirm Companion replies first
   with one `pr.merge` card. Click Decline and confirm the card shows
   "You declined this. Nothing was executed from this card."
5. GitHub Pages picks up `docs/council-front-door.js` on the next Pages build.

No new secrets or environment variables are required.
