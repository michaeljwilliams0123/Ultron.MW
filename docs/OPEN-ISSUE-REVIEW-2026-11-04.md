# Ultron.MW open-issue review (28 issues) — 2026-11-04, main @ fdd948a

Common finding: every issue already carries acceptance criteria. All 28 stay OPEN because each needs **live external evidence** (deployed Hatchable readback, authenticated provider receipt, observed run), not more source. Source merges and CI/Council/CodeRabbit output are not acceptance. Paid spend stays $0.

## Fixed / addressed in this pass
| # | Disposition |
|---|---|
| 285 | BE-H01 root cause: `cloud-pr.yml` declared reserved `GITHUB_TOKEN` secret -> invalid workflow, `startup_failure`. Fixed by #287 (merged). Still needs one live `@ultron implement` run to flip BE-H01..H03 to PASS. |

## Tier 1 — identity/execution foundation (do first, in this order)
| # | State | Minimum remaining acceptance |
|---|---|---|
| 285 | Open, test owner | One owner `@ultron implement` on an owner issue -> real Actions job (not startup_failure), exactly one PR + Hatchable `external_url`; replay of same comment = no 2nd PR. |
| 187 C05 | $0 guard source only | Registry config add/disable/rollback with no planner edit; 8 manifests honest connected/ready/blocked; paid/unsupported op rejected pre-call (live denial receipt). |
| 183 C01 | Source landed | Deployed PostgreSQL: kill process mid-task + duplicate delivery + stale lease -> one external effect; SQL readback matches tested SHA. |
| 225 C18 | 3/11 done | Owner profile (observe/build/release) change is honored by next admission; stop CAS blocks new effects. |
| 169 / 167 / 168 | Principal topology unresolved (#198 two-App vs #199 unified) | Pick ONE principal (unified `ultron-github-app`); one reversible admin canary w/ step-up; same action denied via repair lane/replay/altered plan; rollback read back. 168: one seeded failure -> one branch+PR -> exact-head CI -> terminal receipt; duplicate/response-loss = no duplicate effects. |

## Tier 2 — external executors (blocked on account-side action)
| # | Blocker | Acceptance |
|---|---|---|
| 190 C08 | No independent Mahoraga/GitLab receipt | One Ultron->Mahoraga and reverse handoff with verifiable receipts; GitLab artifact links without implying GitHub approval; no relay loops. |
| 245 / 269 / 248 | Needs model-authored 3+ file repair; HF signed ingestion; ZeroGPU eligibility | 245: 3+ model-attributed files, exact-head CI, squash, deployed bytes == merged source, independent runtime postcondition. 269: signed delivery -> single receipt -> UI update; tamper/replay/stale denied. 248: real free allocation read back, else precise `HF_SPACE_WRITE_OR_ELIGIBILITY_REQUIRED` hold. |
| (Destiny/Mike, tracked in 182/204) | Mike route not enrolled; Destiny `liveExecution: not-verified`; trust record `unconfigured` | One read-only Destiny Codex Cloud task with task URL + independently pinned signer; Mike enrolls own Work route separately. No shared-GitHub-actor attestation. |

## Tier 3 — operations/UI/acceptance harness
| # | Acceptance (unchanged, summarized) |
|---|---|
| 170 / 194 | Hatchable owner UI runs intake->verify->persist; live negatives (auth, CSRF, expiry); rollback; Pages retired only after parity proven. |
| 184 C02 | 24h live run, real missed-tick/restart recovery, >=99.5%/7d measured not simulated. |
| 186 C04 | v51 council-readiness 503 fixed; contradiction changes a disposition and survives restart. |
| 173 | Honest paired Reef eval (unloadable side = inconclusive, evaluator identity distinct from author). |
| 204 | Reusable harness + per-case PASS/FAIL ledger; keep `productionAccepted:false` until external readback. |
| 195 C13 | Whole-program go/no-go dossier after Tier 1-2 (24h pilot, 7d SLO, $0 spend). |

## Tier 4 — future-state, do not start until Tier 1-2 exit
191 (research intake, >=5 ranked sourced candidates), 192 (browser canaries), 193 (experience memory + held-out scoring), 189 (OpenAPI adapters, >=3 canaried), 219/220 (forecast/scenario; synthetic vs live labeled), 221 (portfolio), 222 (capability invention). All output remains proposals until independently authorized.

## Notes
- #185 and #188 are CLOSED though their live criteria were never met; track their remaining proof in #204/#285.
- Many bodies stack 3-4 historical status blocks; consider collapsing, keeping original checklists.
