#!/usr/bin/env bash
# Non-force, source-exact Git transport. Refuses divergence and verifies destination SHA.
set -euo pipefail
remote="$1"
source_sha="$(git rev-parse HEAD)"
if ! [[ "$source_sha" =~ ^[0-9a-f]{40}$ ]]; then echo 'Invalid upstream commit' >&2; exit 2; fi
read_head(){ git ls-remote "$remote" refs/heads/main | awk '$2 == "refs/heads/main" {print $1}'; }
target_sha="$(read_head)"
if ! [[ "$target_sha" =~ ^[0-9a-f]{40}$ ]]; then echo 'GitLab main missing or unreadable; abort' >&2; exit 3; fi
if [[ "$target_sha" == "$source_sha" ]]; then echo "PARITY $source_sha"; exit 0; fi
# Imported GitLab head must be an actual ancestor of canonical GitHub history.
if ! git cat-file -e "$target_sha^{commit}" 2>/dev/null; then
  git fetch --no-tags "$remote" "$target_sha" >/dev/null
fi
if ! git merge-base --is-ancestor "$target_sha" "$source_sha"; then
  echo "CONFLICT: GitLab main $target_sha is not an ancestor of GitHub $source_sha; no force-push" >&2
  exit 4
fi
git push "$remote" "$source_sha:refs/heads/main" >/dev/null
observed_sha="$(read_head)"
if [[ "$observed_sha" != "$source_sha" ]]; then
  echo "SYNC UNCONFIRMED: GitLab head differs from $source_sha" >&2
  exit 5
fi
echo "SYNCHRONIZED $observed_sha"
