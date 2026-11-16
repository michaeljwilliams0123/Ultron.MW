# Ultron.MW Council — ChatGPT plan provider (official SIWC)

**Current scope:** owner-controlled open-source local/self-hosted model adapter. Opt-in only. No external ChatGPT credentials or paid OpenAI API key in GitHub Actions, a pull request, Pages, or Hatchable. Existing Gemini/Groq model reviews remain unchanged by default.

## What this connects

OpenAI's **Sign in with ChatGPT** OSS flow uses dynamic client registration, a stable per-host ID, local `127.0.0.1` PKCE callback, verified OIDC ID token and separately approved `chatgpt.tokens.use.direct` scope. It authorizes selected **Responses API models available to that account**, not access to the user's ChatGPT conversations, memory, tools, UI, or this assistant's reasoning transcript.

The official self-service path is for open-source local apps / self-hosted VMs. OpenAI directs *remotely hosted apps* to its separate approval process: https://openai.com/form/sign-in-with-chatgpt-interest/. **Do not transplant SIWC refresh/access tokens into Hatchable or GitHub Actions** as a shortcut. No dependency on a local PC should be introduced into the currently working Hatchable production scheduler.

The user has authorized implementation of this optional adapter. The owner must still approve the OAuth grant directly in the Windows browser; agents cannot grant scope on the owner's behalf.

## Local setup (owner-controlled SD009WC7 or supported self-hosted OSS VM)

From the source checkout:

```powershell
node scripts/chatgpt-plan-council.mjs status
node scripts/chatgpt-plan-council.mjs login
node scripts/chatgpt-plan-council.mjs models
node scripts/chatgpt-plan-council.mjs canary <MODEL_SLUG_FROM_MODELS>
```

`login` starts a one-time `127.0.0.1` callback listener and opens the **system browser on the same host** for ChatGPT consent. The browser must complete this session and approve use of the plan; the CLI validates state, PKCE, client ID and OpenAI-signed JWT before storing anything. Do not copy authorization callback URLs or tokens into ChatGPT, issues or email.

Tokens live under the current user's `~/.ultron/chatgpt-plan/` directory, outside the repository, protected with Unix mode `0600` or a Windows account-specific ACL. The CLI never displays token values, sends them through arguments, or makes a billable API-key call. The native OAuth refresh endpoint rotates short-lived access and refresh tokens under the issued client ID; a local lock prevents two simultaneous refreshes. After revocation, reconnect with `login`.

On ChatGPT, review **Settings → Usage** and app limits/credit settings; disable optional credit spending if necessary to enforce $0 incremental spend. The provider **never uses the separately billed OpenAI API key**, but plan access shares your existing ChatGPT allowance and may be rate-limited.

## Council integration

In an authorized local OSS host, inject a validated credential object and an exact model slug from the user's `GET https://api.openai.com/v1/models` catalog into:

```js
runReasoningRound({
  input: publicExactHeadCouncilInput,
  order: ['openai-chatgpt'],
  chatgptPlan: {credential: ownerValidatedCredential, model: selectedSlug}
});
```

Seven existing Council logical roles remain distinct. This is advisory, **not an eighth release signer**, GitHub App identity, owner authentication or release permission. No default use in GitHub Actions/Hatchable, and no automatic fallback to a separately billed OpenAI API project.

The transport uses only `POST https://api.openai.com/v1/responses` with `store:false`, `stream:true`, `input` as an array, and a restricted `instructions` prompt. It waits for `response.completed` and fails closed on `response.failed`, `response.incomplete`, interrupted streams, malformed JSON, unlisted models, expired credentials, missing scopes, or suspicious external input. Unsupported Responses preview fields and ChatGPT `backend-api` endpoints are never used.

## Acceptance before production

1. Exact mocked OAuth PKCE, callback, OIDC/JWKS validation, rotating refresh and denied-consent tests.
2. Synthetic SSE stream boundary, account model list, output text completion, failed/rate-limited stream, all seven roles and no-token HOLD tests.
3. Owner approves ChatGPT access in the local browser. Real model list and one synthetic owner-approved canary succeed; record *only* status/model/receipt IDs, not credentials.
4. Full GitHub regression and signed exact-head Council review of the source PR.
5. For a **cloud-only** deployment, separately verify SIWC remotely hosted app approval or run an authorized self-hosted OSS host with distinct `ext_agent_host_id`; independently validate remote credential custody and signed provider receipts before activating any Hatchable-side routing. Do not assert cloud ChatGPT binding without this.

## Primary documentation

- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
