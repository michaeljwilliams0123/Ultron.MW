# Ultron.MW — repeated owner sign-in prompt

**Date:** 2026-11-08
**Issue:** [#322](https://github.com/michaeljwilliams0123/Ultron.MW/issues/322)
**Scope:** Hatchable Mission Control v61 owner-session status, not the GitLab/MCP grant signer.

## Executive diagnosis

Mission Control's `public/index.html` contained a permanently visible **Owner sign-in** link. The `public/owner-live.js` realtime status independently called `GET /api/brain/events-token` and interpreted HTTP 401/403 as **Sign in for live private updates**. Neither signal actually checked whether the owner was authenticated for ordinary admin APIs.

This caused a false repeat-login prompt when the owner successfully executed other admin actions:
- owner Chrome click **Create cloud note** created `brain_notes.id=12` and `brain_events.id=1681` in PostgreSQL;
- owner Chrome click **Verify & record C06 receipt** created `c06_live_receipts.id=3`; that receipt verifies historical GitHub evidence, **not** a current-main model run;
- a fresh anonymous Chrome session correctly received HTTP 401 for an owner-protected action;
- the deployed `/api/brain/events-token` is an *optional realtime capability* and may fail independently of the owner session.

The static link alone explains why a correctly authenticated owner saw **Owner sign-in**. These observations **do not establish** an API authorization bypass.

## Sources and platform model

Hatchable owner/collaborator authentication uses the platform `hatchable_session` cookie and `access='admin'` platform-edge gate. The signed-in *app user* identity from `[auth]` is separate, not an alternative owner permission. Browser JS must not read/copy the private HttpOnly cookie.

- Hatchable SDK: https://hatchable.com/docs/developers/sdk
- Hatchable session bridge/privacy: https://hatchable.com/privacy (Nov 4, 2026 section “On sites published with Hatchable”)
- Hatchable app auth distinction: https://hatchable.com/docs/developers/config
- MDN same-origin fetch credentials: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch

A user may be signed in on `hatchable.com` yet lack the bridged app-host cookie until visiting the private project through the platform-provided sign-in link. Thus an actual **401/403 from the owner-session route** means the current site request was not owner-authenticated. A temporary 5xx/network error is **unverified**, not proof that another login is needed.

## Implemented repair

- Add `GET /api/brain/session` as `access='admin'` with exact owner handle check. A successful response contains only schema, authenticated flag and owner handle. No secrets, third-party tokens, authorization grants, private signing keys or DB writes. `Cache-Control: private, no-store`; `Vary: Cookie`.
- Add `public/owner-session.js` to read the protected endpoint with same-origin cookie credentials, distinguish **authenticated**, **guest** and **unknown**, and refresh on focus/pageshow after a console login. The permanent sign-in link starts hidden and becomes visible **only** when the session API returns 401/403.
- Change `public/owner-live.js`: realtime 401/403 is reported as **“Owner authenticated · live updates unavailable”** when the owner-session check succeeded. Guest sessions still receive a truthful login prompt. Realtime 5xx and missing transport remain **unavailable**, not signs of logout.
- Preserve all existing server-side owner checks on cloud notes, C06, GitLab, autonomy and other write APIs. The new owner-session status is a *display and navigation hint* only, never an authorization token.
- Replace misleading static copy suggesting every visitor must sign in again.

## Regression matrix

| Case | Expected | Evidence |
| --- | --- | --- |
| Owner session 200, events-token 401 | Sign-in hidden; “Owner authenticated”, realtime unavailable | Node browser-event simulation |
| Session 401 and realtime 401 | Sign-in shown; no claim of owner authorization | Node browser-event simulation |
| Session 503 and realtime 503 | Session unverified; no forced re-login | Node browser-event simulation |
| Server admin owner request | 200, no-store, bounded identity only | API handler regression |
| Direct wrong owner/anonymous handler input | 403, no authentication asserted | API handler regression |
| Identity checks | Same-origin cookies, no storage/session JS authority | Source regression |
| Anonymous cloud note and C06 POST | Existing 401 via platform edge | Live production negative probes from #322 |
| Owner cloud-note UI action | Postgres note #12 and event #1681 persisted | Live browser action/readback #322 |
| Owner C06 UI action | PostgreSQL receipt #3, historical evidence only | Live browser action/readback #322 |
| GitLab owner-signed branch write | **Not performed by this fix** | Provider/authority ledgers remained 0 at baseline |

## Deployment acceptance

1. Run focused `node --test test/hatchable-owner-session-indicator.test.mjs` and full `node scripts/verify.mjs`.
2. Merge reviewed exact-head PR after required GitHub CI; deploy only changed source files into existing Hatchable project (no additional OAuth grants, signing keys or paid resources).
3. Run `GET /api/brain/session` as owner (200), public (401), and non-owner member (403).
4. In the existing owner Chrome session, reload Mission Control. Confirm the top link is hidden and status reports owner authenticated; realtime status independently shows connected or unavailable.
5. In a fresh anonymous profile, check sign-in link is visible and cloud write APIs reject unauthenticated requests.
6. Confirm no database mutations from the session probe and verify no GitLab write/authority-grant ledger changes.

**Reauth only if the protected owner-session endpoint actually returns 401/403.** In that case, visit the project through the Hatchable console to complete its secure session bridge. Do **not** clear cookies or disable browser protection merely because the realtime channel failed.

## Boundary / rollback

Rollback is a normal GitHub PR and Hatchable deployment rollback. The repair changes visual status and a read-only route; it does not expand provider privileges. Preserve owner-only authorization, P-256 signed grants, profile/stop fences, no duplicate writes, and paid spend ceiling **$0**. No second human signer is required.
