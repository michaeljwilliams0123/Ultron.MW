#!/usr/bin/env bash
set -euo pipefail
# Official actionlint v1.7.12 Linux amd64 release, digest from release metadata.
lint_tmp="$(mktemp -d)"
trap 'rm -rf "$lint_tmp"' EXIT
curl --fail --silent --show-error --location --max-time 60 \
  https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz \
  --output "$lint_tmp/actionlint.tar.gz"
printf '%s  %s\n' \
  8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 \
  "$lint_tmp/actionlint.tar.gz" | sha256sum --check --status
tar --no-same-owner -xzf "$lint_tmp/actionlint.tar.gz" -C "$lint_tmp" actionlint
"$lint_tmp/actionlint" -color
