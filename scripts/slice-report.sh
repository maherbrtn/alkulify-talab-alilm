#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/project-common.sh"
report_scan() {
  local result
  if "$@"; then
    printf 'None found.\n'
  else
    result=$?
    if (( result == 1 )); then
      printf 'FINDINGS DETECTED\n'
    else
      printf 'SCAN ERROR (exit %s)\n' "$result"
      return "$result"
    fi
  fi
}

report() {
  printf 'Slice review report\nGenerated: %s\n\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  print_identity
  print_worktree
  printf '\nChanged tracked files (relative to HEAD):\n'
  git diff HEAD --name-status
  printf '\nUntracked files:\n'
  git ls-files --others --exclude-standard
  printf '\nUnstaged diff stat:\n'
  git diff --stat
  printf '\nStaged diff stat:\n'
  git diff --cached --stat
  printf '\nRecent commits:\n'
  git log -5 --oneline
  printf '\nLocal Supabase migration versions:\n'
  migration_files | while IFS= read -r name; do printf '%s\n' "${name%%_*}"; done
  printf 'Latest migration filename: %s\n' "$(migration_files | tail -1)"
  printf '\nTracked conflict marker scan:\n'
  report_scan check_conflicts
  printf '\nTracked secret filename scan (heuristic; templates excluded):\n'
  report_scan check_secrets
  printf '\nUntracked whitespace scan:\n'
  report_scan check_untracked_whitespace
  printf '\nBefore final review, run: pnpm slice:verify\nThis report does not run verification or certify a passing build.\n'
}
# Refuse symlinks; only the explicitly requested temporary report is written.
output=/tmp/alkulify-slice-report.txt
if [[ -L "$output" || ( -e "$output" && ( ! -f "$output" || ! -O "$output" ) ) ]]; then
  printf 'ERROR: refusing unsafe report destination: %s\n' "$output" >&2
  exit 1
fi
umask 077
report | tee "$output"
