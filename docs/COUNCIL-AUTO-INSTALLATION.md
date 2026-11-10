# Automatic GitHub App installation proof

The source repository is now `Ultron-MW/Ultron.MW` (repository ID `1424939667`), transferred from the original personal namespace. This is a repository rename/transfer, not a second repository.

The `Council GitHub App identity proof (read-only)` workflow reuses the existing `ULTRON_BUILDER_CLIENT_ID` variable and protected `ULTRON_BUILDER_PRIVATE_KEY` secret, which are associated with the Ultron Coordinator App (numeric App ID `5633654` on `ULTRON_GITHUB_APP_ID`). The pinned official `actions/create-github-app-token` action dynamically discovers the installation on the *current repository owner* and scopes an ephemeral token to the current repository, requesting only metadata:read. It validates the returned `app-slug` before running the existing read-only installation-token and repository-ID proof. The action revokes its temporary token at job completion. No manual installation ID variable and no new private-key secret are needed.

If Coordinator is not installed for the `Ultron-MW` organization/repository, the action fails closed. If the old protected PEM does not belong to Coordinator or has been revoked, it also fails; neither case is a valid 1/7 identity proof. Install/re-authorize the real App through GitHub's normal controls, not by copying an unrelated key.

A successful workflow verifies exactly **one** GitHub App installation, not seven independent authenticated Council persons. Results are a sanitized artifact; the cloud production readiness endpoint is not automatically updated by this workflow. Task 1–5 write operation admission and Hatchable signed owner approval are separately tested gates, not part of this proof.

Run: `node --test test/council-installation-autodiscovery.test.mjs test/council-fleet-probe.test.mjs`. The trusted GitHub App-client-ID-to-PEM association is proved by a real API exchange, not the existence of secrets or mock callbacks.