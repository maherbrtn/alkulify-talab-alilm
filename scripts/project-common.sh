#!/usr/bin/env bash
# Shared read-only Git inspection for the three developer commands.
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0

project_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo 'ERROR: run this command inside the alkulify-talab-alilm Git repository.' >&2
  return 1
}
script_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
if [[ "$project_root" != "$script_root" ]] ||
   [[ ! -f "$project_root/package.json" || ! -d "$project_root/supabase/migrations" ]]; then
  echo 'ERROR: current Git repository does not match the tooling repository.' >&2
  return 1
fi
cd -- "$project_root"

print_identity() {
  printf 'Project: alkulify-talab-alilm\nBranch: %s\n' "$(git symbolic-ref --quiet --short HEAD || printf 'DETACHED')"
  git log -1 --format='HEAD: %h%nCommit: %s'
  local upstream ahead behind
  if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null); then
    read -r ahead behind < <(git rev-list --left-right --count "HEAD...$upstream")
    printf 'Upstream: %s\nSync (local refs; no fetch): ahead %s, behind %s\n' "$upstream" "$ahead" "$behind"
  else
    printf 'Upstream: none or unavailable\nSync: unknown\n'
  fi
}

print_worktree() {
  local entry modified=0 untracked=0
  while IFS= read -r -d '' entry; do
    if [[ ${entry:0:2} == '??' ]]; then
      untracked=$((untracked + 1))
    else
      modified=$((modified + 1))
      # Porcelain -z emits an extra pathname for renames/copies.
      if [[ ${entry:0:2} == *R* || ${entry:0:2} == *C* ]]; then
        IFS= read -r -d '' entry
      fi
    fi
  done < <(git status --porcelain=v1 -z --untracked-files=all)
  if (( modified == 0 && untracked == 0 )); then
    printf 'Working tree: clean\n'
  else
    printf 'Working tree: dirty\n'
  fi
  printf 'Modified tracked files (staged or unstaged, including additions/deletions): %s\nUntracked files: %s\n' "$modified" "$untracked"
  git status -sb
}

migration_files() {
  local path
  for path in supabase/migrations/*.sql; do
    [[ -f "$path" ]] || continue
    printf '%s\n' "${path##*/}"
  done | LC_ALL=C sort
}

# Print filenames only, never potential secret contents. Scan tracked text
# files in both the working tree and index (including staged-only mistakes).
check_conflicts() {
  local mode result found=0
  for mode in worktree index; do
    local args=()
    [[ "$mode" != index ]] || args+=(--cached)
    if git grep "${args[@]}" -I -l -E '^(<{7,}|>{7,}|[|]{7,})( |$)|^={7,}[[:space:]]*$' -- .; then
      printf 'Conflict markers found in %s tracked files.\n' "$mode"
      found=1
    else
      result=$?
      (( result == 1 )) || return "$result"
    fi
  done
  return "$found"
}

check_secrets() {
  local path name found=0
  while IFS= read -r -d '' path; do
    name=${path##*/}
    case "$name" in
      .env.example|.env.sample|.env.template|.env.*.example|.env.*.sample|.env.*.template) continue ;;
      .env|.env.*|*.pem|*.key|*.p12|*.pfx|id_rsa|id_ed25519|id_ecdsa|credentials.json|service-account*.json|service_account*.json)
        printf 'Likely tracked secret file: %q\n' "$path"
        found=1 ;;
    esac
  done < <(git ls-files -z)
  return "$found"
}

# Node is already required by the project. Read each eligible file once and
# reject NUL-containing binary data before inspecting lines; print no contents.
check_untracked_whitespace() {
  node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'

const paths = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'])
  .toString('utf8').split('\0').filter(Boolean)
let found = false
for (const path of paths) {
  if (!lstatSync(path).isFile()) continue // Includes neither symlinks nor directories.
  const bytes = readFileSync(path)
  if (bytes.includes(0)) continue
  const lines = bytes.toString('utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    // Accept CRLF line endings, but detect spaces/tabs before them.
    if (/[ \t]+\r?$/.test(lines[i])) {
      console.log(`${JSON.stringify(path)}:${i + 1}: trailing whitespace`)
      found = true
    }
  }
}
process.exitCode = found ? 1 : 0
NODE
}
