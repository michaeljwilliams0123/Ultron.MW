# Security and data boundaries

Ultron is an experimental, single-owner system. Only behavior supported by source, tests, and dated runtime evidence should be treated as available. Capability catalogues, manifests, and deliberation receipts describe implementation support; they do not certify deployment, provider readiness, or expanded authority.

## Reporting a vulnerability

Do not publish credentials, personal data, private client material, or a working exploit in a public issue.

- Prefer GitHub’s **Report a vulnerability** option when private vulnerability reporting is enabled for the repository.
- If that channel is unavailable, open a minimal public issue that asks the owner to establish a private reporting path. Include no sensitive details, credentials, or exploit steps.
- No private reporting address, security@ alias, or enabled GitHub security feature is claimed by this document. Confirm the current reporting path with the repository owner before disclosure.

## Public and local data

| Data | Location | Protection / audience | Notes |
|------|----------|-----------------------|-------|
| Repository source, task Issues, receipts, Pages | GitHub | Public | Console submits only supported command names; manually edited Issues can still disclose private information. Changing visibility later cannot retract prior copies. |
| Cloud receipts | Issue comments + Actions | Public (repository visibility) | Contain observations, digests, and provenance. A digest is not encryption. |
| Local state & owner notes | `.local/state.json`, fixed notes directory | Plaintext; filesystem controls | Owner responsibility for access, backups, and deletion. |
| Browser vault | Opt-in encrypted storage | Passphrase-derived authenticated encryption | Live unlocked context and external CDN-loaded model code have a different threat boundary. Deleting a vault does not erase model caches or exported backups. There is no passphrase recovery. |
| Model / provider context | Browser or local process | Device / process controls | Do not enter secrets. Generated text is untrusted narrative until a separate executor validates and independently reads back results. |

- Do not commit `.env` files, pairing keys, credentials, generated local state, or private objectives.
- Revoke exposed credentials at their source. Deleting a public post or Issue cannot retract copies already made.
- Pages never receives a GitHub API token. Cloud write paths that exist use narrowly scoped, owner-triggered Actions jobs only.

## Execution controls

**Cloud lane**
- Input never becomes a shell command.
- Owner identity, fixed capability catalogue, bounded planning (at most three steps), per-issue concurrency, and timeouts limit the hosted lane.
- Default token remains read-only. Only specifically marked, owner-created workflows request write scopes for Issues, PRs, or contents, and only after re-checking owner identity and current `main`.
- No model output, learned suggestion, task text, or GrokBot deliberation can grant broader authority or execute side effects.

**Local runtime**
- Binds exclusively to loopback (`127.0.0.1`).
- Validates `Host` and write `Origin`.
- Owner-action endpoints additionally require a session key generated at startup (changes on restart).
- Optional GitHub documentation draft adapter is disabled by default and remains narrowly scoped.
- No arbitrary filesystem paths, shell, merge, deployment, or secret-management endpoints exist.
- Uncertain operations are marked `reconcile-required` rather than automatically replayed.

**Cognitive governance and learning**
- GrokBot deliberation receipts (seven fixed cognitive selves) are deterministic, zero-credit, and advisory-only. They cannot execute plans, widen the capability registry, invoke models, spend credits, or promote policy.
- Routing promotion and experience suggestions are policy-selection or suggestion-only boundaries. They do not train model weights, enable adapters, or grant action authority.
- All learning paths require independent held-out evidence and fail closed on insufficient or regressing results.

## Supply-chain and configuration notes

- External Action SHAs and the workflow-linter checksum are pinned in source.
- CI performs a script-disabled install and fingerprints the production dependency graph against a known-clean audit baseline. Dependency changes fail closed until a fresh audit updates that baseline.
- Optional browser WebLLM is loaded from a version-pinned CDN; it is experimental and not a reviewed, bundled production supply chain.
- CI configuration does not itself enforce protected-branch rules, required reviews, Actions retention, or private vulnerability reporting. Those are administrative repository settings and must be verified separately (see the point-in-time settings receipt in the README and baseline documentation).

Administrative settings, actual deployments, and live provider readiness require separate verification. Treat any claim outside source + tests + dated runtime evidence as unsupported.
