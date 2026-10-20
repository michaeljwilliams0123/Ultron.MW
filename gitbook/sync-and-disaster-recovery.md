---
description: "GitHub authoritative source, GitLab downstream recovery and GitBook documentation sync."
---
# GitHub, GitLab and GitBook synchronization

## Authority model

**GitHub `main` → GitLab recovery copy.** GitHub hosts source PRs, required Verify, release acceptance and GitHub Pages. GitLab project `michaelj.williams0123/Ultron.MW` is a separate private downstream replica. It must not become an independent PR, CI, release or deployment authority.

A completed GitLab URL import copies history at that point in time. It is **not an ongoing Git mirror**. Only an independently verified **identical full commit SHA** after an actual Git transport operation establishes that GitLab has caught up.

## Nightly check

A ChatGPT scheduled task is configured to inspect both default-branch SHAs at **11:59 PM America/New_York** using connected GitHub, GitLab and GitBook plugins. It should attempt a verified fast-forward only when authenticated Git transport is available; otherwise it reports a blocker, not fictitious synchronization. The task itself is not a standing cloud process or replacement for GitHub Actions.

## Avoiding conflicts

* If the GitLab head matches GitHub, no action.
* If the GitLab head is an ancestor and a properly scoped transport is available, fast-forward and reread the exact SHA.
* If GitLab contains unique commits, stop: no force push or blind overwrite.
* Do not run GitLab CI or revive predecessor project's branches as part of recovery.
* Never place tokens in documentation or public source. A scope-limited GitLab write credential, if approved, belongs in a protected GitHub Actions secret, not the repository.

## GitBook Git Sync setup

Create or select one GitBook organization and an empty documentation site/space. In the GitBook UI configure **GitHub** as the Git Sync source, repository `michaeljwilliams0123/Ultron.MW`, branch `main`, project directory `gitbook/`, and initial direction **Git → GitBook**. Do not apply the default GitBook template to this existing documentation and do not also connect the GitLab mirror. Git Sync wiring is a GitBook UI action and cannot be done by the API.

Once connected, use GitHub PRs for substantive documentation changes. GitBook can be an indexed reader without becoming a competing editor of `main`.
