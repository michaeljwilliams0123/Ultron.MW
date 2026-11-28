# Issue tracker

Use GitHub Issues in `michaeljwilliams0123/Ultron.MW`. Prefer the existing authenticated GitHub connector or `gh` with explicit repository scope. Read the issue and related PRs before creating a duplicate. Use GitHub's native issue dependencies where supported; otherwise record blocking issue links explicitly.

```sh
gh issue view 527 --repo michaeljwilliams0123/Ultron.MW
gh issue list --repo michaeljwilliams0123/Ultron.MW --state open
```

Each implementation ticket records objective, current evidence, expected behavior, in/out scope, dependencies, test seam, acceptance criteria, rollback and authority/cost boundaries. Use one issue per independently verifiable slice. Update an existing issue rather than scattering redundant tracking. Reference exact PRs, commits and observed receipts. Keep secrets and private data out of public issue content.

PRs as a request surface: **off**. PRs are implementation/review evidence, not the incoming triage queue. A label or issue does not authorize a privileged effect.
