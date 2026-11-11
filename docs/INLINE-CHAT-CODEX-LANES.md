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

## Response quality hardening — PR #394

Live canary [GitHub comment 6783084566](https://github.com/michaeljwilliams0123/Ultron.MW/pull/387#issuecomment-6783084566) demonstrated a true `github-actions[bot]` reply with a generic refusal to a harmless GitHub policy question. A passing GitHub Actions run confirms transport, not answer usefulness. The 0.5B public CPU model remains pinned and is **not** silently upgraded or replaced with paid inference.

The inline handler now has two distinct **answer bases**:

- `github-policy` for a bounded set of repository-policy facts: an `@michaeljwilliams0123ultron` mention is GitHub notification, `/codex run destiny-codex` is an explicit owner-only, read-only C03 provenance audit on an admitted task PR, and `@ultron chat` replies are posted by `github-actions[bot]` rather than Destiny or a ChatGPT Plus session.
- `github-verified` for `What does this PR change?`, reading the current PR's actual GitHub changed-file list. If inventory is inconsistent, truncated, oversized or unavailable, `github-unavailable` links to Files changed instead of presenting guessed files.
- `local-cpu` for other questions, with a less refusal-prone task prompt. A generic refusal, empty response or repeated question fails the response-quality gate and produces `quality-fallback`, including useful documented commands; model/runtime errors produce `model-unavailable`.

The marker still binds replies to the original verified GitHub comment ID; same-repository event admission, actor allowlist, public-only GitHub Actions, least-privilege token scope, duplicate delivery protection and independent comment readback remain unchanged. No API tokens or Codex/ChatGPT/paid provider access are added. This improves **the known policy and metadata questions**, but does not establish general language-model reasoning quality. Monitor actual outputs rather than treating a green Actions workflow as a scored quality pass.

### Verification contract

Run `node --test test/github-inline-chat-quality.test.mjs test/github-inline-chat.test.mjs` and the repository's full exact-head verification. After merging, publish one new owner-authored `@ultron chat Summarize how GitHub mentions differ from deliberate Codex tasks, and state your actual identity and limits.` on PR #387. Verify that the answer states correct distinction and attribution, and check real GitHub Actions conclusion and comment readback; a generic refusal or fallback does not pass acceptance.

## Safety, limitations and rollback

The public CPU workflow is limited to owner/secondary identity checks, open public PRs, a bounded exact `@ultron chat ` command, checkout from trusted `main`, repository read and issue-comment write, one answer, idempotency and independent GitHub readback. It cannot push, merge, deploy, authenticate to ChatGPT, charge a provider or change external Codex preferences. It invokes no OpenAI API and has no paid fallback. If inference cannot run, it posts an explicit unavailable response.

Remove the opt-in workflow/handler by reverting this PR to restore the previous inline behavior; keep explicit Codex admission and human mentions separate unless a separately reviewed policy change is approved.
