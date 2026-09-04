#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/project-common.sh"
print_identity
print_worktree
printf '\nRecent local Supabase migrations:\n'
migration_files | tail -5
latest=$(migration_files | tail -1)
printf 'Latest migration version: %s\n' "${latest%%_*}"
printf '\nRecent commits:\n'
git log -5 --oneline
