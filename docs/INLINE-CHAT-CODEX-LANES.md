# Owner-to-Ultron conversation and Codex lane separation

## Decision — November 10, 2026

Owner: `michaeljwilliams0123`; secondary collaborator: `michaeljwilliams0123ultron`; canonical repository: `michaeljwilliams0123/Ultron.MW`.

Observation PR #387 showed a Codex usage-limit response **before** the owner posted the secondary-account mention. It does not demonstrate that the mention invoked Codex. The mention separately triggered the read-only C03 audit (run 42925178463), which failed to establish admission. Merged PR #385 had deliberately made bare tags C03 aliases; this fix changes the boundary to require explicit intent.

## Three compared directions

| Direction | Operation | Cost/capability | Disposition |
| --- | --- | --- | --- |
| Automatic Codex PR reviews | External ChatGPT Codex GitHub integration | Plan allowance and limit behavior, configured in Codex preferences | Not relied upon for conversation |
| Destiny's ChatGPT Plus as an unattended GitHub bot | Supported account-side opt-in required | Plus web chat is not an unlimited free webhook inference API; participating app sign-in can use shared Work/Codex allowances | Not implemented; no token or session impersonation |
| Public-CPU inline GitHub conversation | Opt-in GitHub Actions runner, open model weights pinned by existing repo | No OpenAI API calls or Codex credits, but public runner/model availability, quality and compute are limited | Selected as separate fallback |

## User-visible commands

| PR comment | Outcome | Verified identity |
| --- | --- | --- |
| `@michaeljwilliams0123ultron` | Ordinary GitHub notification. Ultron does not route it to C03 or public CPU | Human GitHub collaborator |
| `@ultron chat Why did CI fail?` | Authorized owner or secondary collaborator requests bounded *read-only* public CPU answer. One reply with a durable comment marker and GitHub readback | `github-actions[bot]`; **not** Destiny's ChatGPT |
| `/codex run destiny-codex` | Existing named C03 GitHub **provenance-only** audit on a verified task PR. Not proof of external execution | Owner command |
| `@codex review` | External Codex code review when integration permits; subject to its own settings/limits | External `chatgpt-codex-connector[bot]` |

The public-CPU inline lane is **not ChatGPT Plus** and must not be represented as Destiny's response. Destiny can independently sign into ChatGPT Plus, connect her own authorized GitHub account, find the PR through ChatGPT Code Review, and use normal chat there. Plain GitHub mentions cannot launch another person's ChatGPT conversation.

## Verification

1. Run `node --test test/github-inline-chat.test.mjs`; `node --test test/codex-authors.test.mjs test/codex-trigger-gate.test.mjs test/pr-brain.test.mjs`; and the full `node scripts/verify.mjs` gate.
2. After merging, publish an **explicit** owner canary on observation PR #387: `@ultron chat Explain the difference between a GitHub mention and a Codex task.` Check the exact `Ultron public CPU inline PR chat` Actions run and the independently read-back comment. A fallback stating the model is unavailable is not evidence of successful inference.
3. Confirm a plain secondary @mention **does not** start a C03 job; its GitHub notification reception can only be checked in the secondary account.
4. Do not fire a second external Codex request solely for verification. If an owner does choose to run a Codex review, compare actual usage in the authenticated account before/after the request. The observed usage-limit bot comment does not establish whose allowance was debited.

## External account setting that source code cannot change

The [Codex code review settings](https://chatgpt.com/codex/settings/code-review) control automatic reviews, including on PR creation and pushes. The relevant signed-in account must disable automatic review or restrict triggers if desired. This cannot be guaranteed or changed from this repository's Actions YAML.

Destiny's ChatGPT Plus subscription is separate from the OpenAI API. Sign in with ChatGPT for participating apps can draw from included Work/Codex allowance, rather than creating an independent zero-credit GitHub bot.

## Live PR #387 permission repair (November 10, 2026)

Initial live canary workflow [42929091449](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42929091449) passed its unit tests and reached the PR comment operation but GitHub responded HTTP 403. The runner's observed `GITHUB_TOKEN` effective scope was `Contents: read; Issues: write`, with no Pull requests scope. The dedicated job now adds **Pull requests: write** solely for PR timeline replies; GitHub's regular comment endpoint may require both scopes on affected installations (see [upstream GitHub report](https://github.com/github/rest-api-description/issues/6994)). This remains narrower than Contents write and does not allow source pushes. A successful response must still be independently read back as an actual GitHub comment; token permission alone is not successful acceptance.

## Small-model quality behavior

The successful [live reply to PR #387](https://github.com/michaeljwilliams0123/Ultron.MW/pull/387#issuecomment-6783084566) was actually authored by `github-actions[bot]` and the workflow [42930467165](https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/42930467165) succeeded, with C03 audit skipped. However, the 0.5B-class local model returned only a generic refusal to a harmless question. Transport acceptance must not be confused with useful inference. A narrowly scoped refusal detector now substitutes **clearly labeled deterministic lane facts** for this particular non-answer; it does not claim to answer arbitrary questions, use the ChatGPT Plus subscription, or launch Codex. The fallback is deliberately transparent and requires no provider credits.

## Safety, limitations and rollback

The public CPU workflow is limited to owner/secondary identity checks, open public PRs, a bounded exact `@ultron chat ` command, checkout from trusted `main`, repository read and issue-comment write, one answer, idempotency and independent GitHub readback. It cannot push, merge, deploy, authenticate to ChatGPT, charge a provider or change external Codex preferences. It invokes no OpenAI API and has no paid fallback. If inference cannot run, it posts an explicit unavailable response.

Remove the opt-in workflow/handler by reverting this PR to restore the previous inline behavior; keep explicit Codex admission and human mentions separate unless a separately reviewed policy change is approved.
