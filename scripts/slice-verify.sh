#!/usr/bin/env bash
set -Eeuo pipefail
trap 'result=$?; printf "\nSLICE VERIFY: FAIL\nFailing command: %s (exit %s)\n" "${current_command:-$BASH_COMMAND}" "$result" >&2; git status -sb >&2 || true; exit "$result"' ERR
source "$(dirname -- "${BASH_SOURCE[0]}")/project-common.sh"
printf 'Branch: %s\n' "$(git symbolic-ref --quiet --short HEAD || printf 'DETACHED')"
run() {
  printf -v current_command '%q ' "$@"
  printf '\nRunning:'
  printf ' %q' "$@"
  printf '\n'
  "$@"
}
run pnpm check
run pnpm exec tsc --noEmit
run pnpm build
run git diff --check
run check_untracked_whitespace
run check_conflicts
run check_secrets
printf '\nFinal Git status:\n'
git status -sb
printf '\nSLICE VERIFY: PASS\n'
