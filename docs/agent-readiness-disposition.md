# Agent readiness disposition

Baseline: [scan wHK3NxibOF](https://agent-ready.dev/scan/wHK3NxibOF), 30/100 readability, 0/100 llms.txt, 100/100 automated accessibility (one page). 42 non-passing checks: 38 failures, four warnings. No post-release scan or deployed acceptance has been established. The following is source-level triage, not a scored result.

Privacy: default deny crawling; allow only the exact curated static documents. No broad snippet or indexing permissions. Existing authorization is independent of robots directives. Preserve noindex,nofollow on every HTML page, including the public guide. No public private-route inventory. Unsupported protocols are not fabricated to increase the score.

| Check | Ticket | Source disposition |
|---|---|---|
| S1 | #580 | Curated index submitted; live HTTP status, MIME and links pending. |
| S2 | #580 | Curated index submitted; live HTTP status, MIME and links pending. |
| S3 | #580 | Curated index submitted; live HTTP status, MIME and links pending. |
| S4 | #580 | Curated index submitted; live HTTP status, MIME and links pending. |
| S5 | #583 | Policy-limited: approved documents only; broad crawl access intentionally excluded. |
| S7 | #583 | Scoped robots file in candidate; deployed readback pending. |
| S8 | #580 | Curated assets and dates submitted; deployed parse/readback pending. |
| S9 | #580 | Curated assets and dates submitted; deployed parse/readback pending. |
| S10 | #580 | Curated assets and dates submitted; deployed parse/readback pending. |
| S11 | #580 | Curated assets and dates submitted; deployed parse/readback pending. |
| S12 | #580 | Curated assets and dates submitted; deployed parse/readback pending. |
| S13 | #580 | Curated assets and dates submitted; deployed parse/readback pending. |
| S15 | #582 | OpenAPI remains outstanding; no unapproved capability exposure. |
| P5 | #581 | Public guide metadata submitted; root operator UI intentionally unchanged; live scan pending. |
| P6 | #581 | Public guide metadata submitted; root operator UI intentionally unchanged; live scan pending. |
| P7 | #581 | Public guide metadata submitted; root operator UI intentionally unchanged; live scan pending. |
| P8 | #581 | Public guide metadata submitted; root operator UI intentionally unchanged; live scan pending. |
| P10 | #581 | Public guide metadata submitted; root operator UI intentionally unchanged; live scan pending. |
| P11 | #581 | Public guide metadata submitted; root operator UI intentionally unchanged; live scan pending. |
| P14 | #580 | Curated glossary and guide link submitted; deployed discovery pending. |
| P15 | #581 | Explicit Markdown representation submitted; deployed MIME and discovery pending. |
| P16 | #581 | Explicit Markdown representation submitted; deployed MIME and discovery pending. |
| P17 | #581 | Explicit Markdown representation submitted; deployed MIME and discovery pending. |
| P18 | #581 | HTTP Link header and Accept negotiation unresolved on direct origin; explicit alternate available in source. |
| P19 | #581 | HTTP Link header and Accept negotiation unresolved on direct origin; explicit alternate available in source. |
| P20 | #581 | Markdown sitemap section submitted; deployed readback pending. |
| P24 | #580 | Public guide describedby link submitted; root operator UI intentionally unchanged. |
| P25 | #583 | Policy-excluded: broad snippet directives are not appropriate for private control surfaces. |
| L1 | #580 | Allowlisted generated docs submitted; deployed status/MIME/link checks and rescan pending. |
| L2 | #580 | Allowlisted generated docs submitted; deployed status/MIME/link checks and rescan pending. |
| L3 | #580 | Allowlisted generated docs submitted; deployed status/MIME/link checks and rescan pending. |
| L4 | #580 | Allowlisted generated docs submitted; deployed status/MIME/link checks and rescan pending. |
| L5 | #580 | Allowlisted generated docs submitted; deployed status/MIME/link checks and rescan pending. |
| L6 | #580 | Allowlisted generated docs submitted; deployed status/MIME/link checks and rescan pending. |
| L7 | #580 | Allowlisted generated docs submitted; deployed status/MIME/link checks and rescan pending. |
| L8 | #580 | Allowlisted generated docs submitted; deployed status/MIME/link checks and rescan pending. |
| L9 | #580 | Allowlisted generated docs submitted; deployed status/MIME/link checks and rescan pending. |
| L10 | #580 | Allowlisted generated docs submitted; deployed status/MIME/link checks and rescan pending. |
| C8 | #582 | Unsupported discovery edge correction submitted separately; direct Hatchable fallback still unresolved; never claim support. |
| C9 | #582 | Unsupported discovery edge correction submitted separately; direct Hatchable fallback still unresolved; never claim support. |
| C13 | #582 | Unsupported discovery edge correction submitted separately; direct Hatchable fallback still unresolved; never claim support. |
| C14 | #582 | Unsupported discovery edge correction submitted separately; direct Hatchable fallback still unresolved; never claim support. |

## Release evidence required

Record exact merged SHA and deployed version, independently compare the deployed manifest, and verify status, MIME, body, links, noindex behavior, unauthorized denial, and unsupported-protocol responses using bounded budget-aware requests. Run one Agent Ready rescan after all related changes are deployed. Keep policy exclusions distinct from failures; do not promise a score or close tickets without evidence. Existing #526 UI acceptance is separate. Use existing CI only; no new scheduler, paid inference, or origin polling.
