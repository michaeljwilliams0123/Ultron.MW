# Owner-to-Ultron GitHub mention observation — 2026-11-10

This is a non-executing observation fixture. It changes no application code, workflow configuration, credentials, or production behavior.

## Question

When the repository owner leaves a plain GitHub PR mention for the secondary collaborator, what observable response (if any) occurs? Distinguish GitHub notification, existing read-only trigger audit, account-authored reply, Codex review, and general ChatGPT conversation.

## Single stimulus

A PR conversation comment consisting only of the collaborator's GitHub @mention, authored by the repository owner. Do not include a Codex invocation or an implementation request.

## Evidence to inspect

- Comment author, timestamp and exact text; any reply's account identity and timestamp
- GitHub Actions workflow name, run result, and whether it dispatches external execution
- Presence or absence of Codex review or Codex task initiation
- The secondary user's GitHub notification and any separate ChatGPT activity (visible only to that account)
- Codex usage/credits, if available from the actual account usage interface

A mention does not itself prove that ChatGPT replied or that Codex credits were consumed. Lack of an immediate reply does not prove no notification was delivered. This PR is intentionally not a request to merge or deploy.
