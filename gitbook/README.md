---
description: "Ultron.MW technical handbook sourced from the canonical GitHub repository."
---
# Ultron.MW — Technical Handbook

Ultron is a single-owner, GitHub-native execution and source-development system. Its canonical source is [Ultron.MW on GitHub](https://github.com/michaeljwilliams0123/Ultron.MW), with the [GitHub Pages console](https://michaeljwilliams0123.github.io/Ultron.MW/) as the user-facing entrypoint.

This handbook describes **verified** architecture and operating limits. It does not replace GitHub issue, pull-request, GitHub Actions or deployment receipts. When documentation disagrees with the current code or independently observed run, GitHub current `main` and actual execution evidence take precedence.

## Where to start

* [System architecture](architecture.md): source ownership and boundaries.
* [Owner commands and recovery](operations.md): how PR comments act and how a failed verification is restored.
* [Release acceptance and evidence](acceptance.md): the distinction between implementation, passing CI, published Pages and real UI interaction.
* [GitHub and GitLab synchronization](sync-and-disaster-recovery.md): one-way recovery replica and nightly reconciliation.
* [Growth decisions and lessons](decisions.md): avoid the code/governance sprawl inherited from Mahoraga.

## Current principle

One source of truth, one protected merge boundary, bounded actions with receipts, and explicit acknowledgment of unknowns. GitLab is a secondary repository, GitBook is a documentation consumer; neither authorizes source evolution or production deployment.

## Data notice

GitHub Ultron is public. Do not place personal secrets, API credentials, private client information or confidential issue text into GitBook source files, public GitHub Issues or PR comments.
