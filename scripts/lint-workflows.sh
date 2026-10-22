#!/usr/bin/env bash
set -euo pipefail
# Official actionlint v1.7.12 releases, digests from GitHub release metadata.
lint_tmp="$(mktemp -d)"
trap 'rm -rf "$lint_tmp"' EXIT
case "$(uname -s):$(uname -m)" in
  Linux:x86_64)
    archive='actionlint_1.7.12_linux_amd64.tar.gz'
    digest='8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8'
    binary='actionlint'
    ;;
  MINGW*:x86_64)
    archive='actionlint_1.7.12_windows_amd64.zip'
    digest='6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9'
    binary='actionlint.exe'
    ;;
  *) echo "Unsupported actionlint platform: $(uname -s) $(uname -m)" >&2; exit 2 ;;
esac
curl --fail --silent --show-error --location --max-time 60 \
  "https://github.com/rhysd/actionlint/releases/download/v1.7.12/$archive" \
  --output "$lint_tmp/$archive"
printf '%s  %s\n' "$digest" "$lint_tmp/$archive" | sha256sum --check --status
case "$archive" in
  *.zip) unzip -q "$lint_tmp/$archive" "$binary" -d "$lint_tmp" ;;
  *) tar --no-same-owner -xzf "$lint_tmp/$archive" -C "$lint_tmp" "$binary" ;;
esac
"$lint_tmp/$binary" -color
