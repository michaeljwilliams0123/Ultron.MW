# Ultron Memory, Skill and Harness Hubs

These are **versioned, public source artifacts**, not a private personal-memory store or a second autonomous executor. Their canonical authoring and approval path is the existing [Ultron GitHub repository](https://github.com/michaeljwilliams0123/Ultron.MW).

## Memory Hub

The [memory catalog](https://github.com/michaeljwilliams0123/Ultron.MW/tree/main/hubs/memory) contains public, evidence-linked facts about the system, indexed by `hubs/catalog.json`. Each source file has an explicit revision and SHA-256 digest. Git commits record who changed facts and why. Storing credentials, client data, or private memories in this **public GitHub** tree is not supported.

A SHA-256 digest is an integrity check of committed content, not proof a remote replica actually wrote the bytes. The original Gemini two-primary write example does not read both stores back, identify a safe previous revision for rollback, or handle concurrent writers. Ultron instead uses **one authoritative GitHub commit history**, with GitLab as a downstream Git backup that must match the identical commit SHA before claiming success.

## Skill Hub

The [skill playbooks](https://github.com/michaeljwilliams0123/Ultron.MW/tree/main/hubs/skills) use `SKILL.md`. The minimal accepted structure has a title, inputs, fail-closed conditions, and test evidence. Each skill must be referenced in the index with a valid digest and test path; the existing required GitHub Verify suite **runs the real Node tests**. Section headings alone are not sufficient to claim correctness, and a GitBook edit does not authorize execution.

The continual-improvement playbook applies Serve → Observe → Grow → Commit while keeping candidate selection separate from publication. It requires exact source and artifact lineage, receipt-linked feedback, disjoint development and held-out cases, independently observed terminal results, invariant checks and honest missing cost/latency data. Plugin availability alone is never recorded as a successful Reef run.

## Harness Hub

The [harness blueprints](https://github.com/michaeljwilliams0123/Ultron.MW/tree/main/hubs/harness) are versioned profiles referencing skill IDs. Their commands must remain within Ultron's currently supported, deterministic read-only command catalogue. A profile cannot create a credential, grant shell access, change protected-main merges, or deploy providers. Execution permissions continue to live in the existing router and action gateway.

## Promotion lifecycle

1. Draft a memory, skill or harness change on an ordinary GitHub pull-request branch (or author a GitBook change request after Git Sync is connected).
2. Update its content hash in `hubs/catalog.json` and include actual regression evidence.
3. Required GitHub `test` checks structure, references, fingerprints, paths, and the full Node suite at the **exact PR head**.
4. Merge through protected GitHub `main`; do not bypass CI or mistake a green check for a deployed capability.
5. GitLab can fast-forward as a downstream recovery repository once an owner-configured secret authorizes Git transport.
6. The private GitBook space should sync **GitHub `main` → directory `gitbook/`** initially; after enabling the two-way integration, use GitBook change requests/branches instead of direct unsupervised production edits.

## GitLab recovery status and controls

[GitLab project](https://gitlab.com/michaelj.williams0123/Ultron.MW) was imported once and is private. GitLab Free native **pull mirroring** is unavailable. A new GitHub workflow can mirror the verified main SHA after the owner configures the two explicit GitHub settings:

- Secret: `ULTRON_GITLAB_MIRROR_TOKEN` (GitLab credential with repository write authorization, created in GitLab and stored only as a GitHub Actions secret).
- Repository variable: `ULTRON_GITLAB_MIRROR_ENABLED=true` to activate the disabled-by-default job.

The workflow performs a non-force fast-forward only after source-head readback and re-reads GitLab's main SHA. Divergence blocks the copy; no independent GitLab CI/deploy is enabled. A protected GitLab branch must allow the specifically authorized token to update it. Do not weaken GitHub branch protections.

The ChatGPT nightly 11:59 PM Eastern task remains an **independent parity observer**, not proof the remote Git transport exists.

## GitBook private status

The owner requested **private GitBook documentation with no public site and no paid upgrade**. The GitBook organization/space exists but the site does not, and Git Sync connection requires the GitBook UI. Keeping GitBook private does **not** make the associated public GitHub Markdown files private. Do not put personal memory data, passwords, tokens or confidential notes in this catalog.

## Acceptance boundary

This proves the catalog and replica's **local fast-forward algorithm** can be validated in CI. It does not claim GitLab live push authorization, GitBook live Git Sync, Cloudflare/Railway dual writes, long-term private user memories, autonomous skill learning, or end-user Pages mobile acceptance until observed separately.

See [release evidence](acceptance.md), [repository operations](operations.md), and [one-way synchronization](sync-and-disaster-recovery.md).
