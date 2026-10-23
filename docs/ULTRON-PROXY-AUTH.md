# Ultron owner-proxy authentication (PR #72)

## Identity and authority

Ultron is Michael's designated digital operator. This does not make a process
the same legal or biometric person as Michael. For unattended GitHub activity,
use an **owner-installed GitHub App identity** and GitHub-granted permissions.
This is not a bypass of human account 2FA and is not evidence of independent
human MFA completion. GitHub records mutations under the app's identity.

The browser track remains separate. The existing isolated headed Chrome
runner pauses at password, passkey and MFA controls and requires the actual
owner to complete any human-presence challenges. It must independently verify
the resulting application state before privileged browser actions. Never copy
an owner's Chrome profile, cookies, passkeys, passwords, OTP seeds, recovery
codes or personal GitHub CLI credential into a browser agent.

## GitHub App: configure once for repository-scoped unattended API use

1. As the repository owner, register a GitHub App through
   https://github.com/settings/apps/new and install it explicitly on
   **michaeljwilliams0123/Ultron.MW**. Choose *Only select repositories*.
2. Grant exactly the permissions needed for each operation, for example
   Contents, Pull requests and Actions. GitHub's Administration permission
   is optional and must be explicitly granted when needed. Not all owner-user
   operations support installation tokens.
3. Generate an App private key and keep it **outside the repository** in
   an OS-protected secret store or trusted cloud-secret environment.
   Never commit, paste into an Issue, log, Pages file or public PR, or print
   the private key, JWT, or installation access token.
4. Configure the trusted runtime with:
   - `ULTRON_GITHUB_APP_CLIENT_ID`: the actual App client ID.
   - `ULTRON_GITHUB_APP_INSTALLATION_ID`: the installed ID.
   - `ULTRON_GITHUB_APP_PRIVATE_KEY_FILE`: absolute protected PEM file path.
   The verified repository numeric ID is 1424939667.
5. From the trusted runtime, run `node scripts/github-app-proxy-preflight.mjs`.
   It performs GET-only admission and repository identity readback, outputs
   **no credential**, and refuses to claim success if anything is missing.

## Execution implementation

`src/computer/github-app-operator.mjs` generates a short-lived RS256
App JWT with clock-skew margin, exchanges it against a single installation
and repository ID, verifies the returned repository and actual permissions,
then maintains an expiring installation token in process memory only.
An explicitly permission-bound `request` method dispatches GitHub API
requests without returning the token. External URLs and redirect following
are rejected. Concurrent callers share one renewal. Auth failures only
cause a bounded refresh of **GETs**; a write never replays automatically
because its server-side effect may already have happened. Writes still need
the existing objective lease, expected SHA, current authority and
post-write readback of the caller's action before being called successful.

Use the operator as a provider capability **after** configuring the GitHub
App. It is not installed by source merge, scheduled tasks, a local mock
or the user's ordinary GitHub CLI sign-in. The preflight proves only read
admission, not any write permission or runtime persistence.

## Verification gates

- `node --test test/github-app-operator.test.mjs` tests RSA signature,
  expiry, one-repository admission, scope refusal, refresh, concurrent callers,
  unsafe URL rejection, 401 behavior and no replay.
- `node scripts/verify.mjs` runs the full repository suite.
- Exact current PR head must pass the existing required GitHub CI.
- Real owner-installed App admission, least-privilege API request, write with
  independent readback, revocation test and offline runtime acceptance are
  **not proven** until individually observed in the target environment.
- Real owner-browser authenticated sign-in, MFA, redirect handling and
  unresolved prior browser checkpoint remain **open acceptance** for PR #72.

Provider references:
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
