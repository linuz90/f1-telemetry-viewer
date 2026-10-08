#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./workspace-setup.sh init

Prepare the current checkout after a managed worktree has been created.
EOF
}

script_dir() {
  local source="${BASH_SOURCE[0]}"
  while [ -h "$source" ]; do
    local dir
    dir="$(cd -P "$(dirname "$source")" >/dev/null 2>&1 && pwd)"
    source="$(readlink "$source")"
    [[ "$source" != /* ]] && source="$dir/$source"
  done
  cd -P "$(dirname "$source")" >/dev/null 2>&1 && pwd
}

resolve_target_root() {
  if [[ -n "${WORKSPACE_TARGET_PATH:-}" ]]; then
    printf '%s\n' "$WORKSPACE_TARGET_PATH"
    return
  fi

  if [[ -n "${CONDUCTOR_WORKSPACE_PATH:-}" ]]; then
    printf '%s\n' "$CONDUCTOR_WORKSPACE_PATH"
    return
  fi

  if [[ -n "${T3CODE_WORKTREE_PATH:-}" ]]; then
    printf '%s\n' "$T3CODE_WORKTREE_PATH"
    return
  fi

  local git_root
  if git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    printf '%s\n' "$git_root"
    return
  fi

  local dir
  dir="$(script_dir)"
  if git_root="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)"; then
    printf '%s\n' "$git_root"
    return
  fi

  printf '%s\n' "$dir"
}

# The checkout to copy .worktreeinclude files from. Falls back to the main
# checkout behind the shared .git dir so plain `git worktree add` works too.
resolve_source_root() {
  local candidate
  for candidate in "${WORKSPACE_SOURCE_PATH:-}" "${CONDUCTOR_ROOT_PATH:-}" "${T3CODE_PROJECT_ROOT:-}"; do
    if [[ -n "$candidate" && -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done

  local common_dir
  if common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; then
    printf '%s\n' "$(dirname "$common_dir")"
  fi
}

# T3 Code and plain Git worktrees do not copy ignored files, and Codex/Claude
# copying is best-effort, so reapply .worktreeinclude here (missing files only,
# never overwriting per-worktree edits). This is what carries the real
# TELEMETRY_DIR in .env into new worktrees.
copy_worktree_includes() {
  local target_root="$1"
  local source_root
  source_root="$(resolve_source_root)"

  [[ -f .worktreeinclude && -n "$source_root" ]] || return 0
  [[ "$(cd "$source_root" && pwd -P)" != "$(pwd -P)" ]] || return 0

  local file
  while IFS= read -r -d '' file; do
    [[ -e "$target_root/$file" ]] && continue
    # Match Codex/Claude semantics: only copy files the target also ignores.
    git -C "$target_root" check-ignore -q -- "$file" || continue
    mkdir -p "$(dirname "$target_root/$file")"
    cp -p "$source_root/$file" "$target_root/$file"
    echo "Copied $file from $source_root"
  done < <(git -C "$source_root" ls-files -z --others --ignored --exclude-from="$target_root/.worktreeinclude")
}

run_pnpm_install() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile
    return
  fi

  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm install --frozen-lockfile
    return
  fi

  echo "pnpm is required. Install pnpm >=10.26.0 or enable Corepack, then rerun setup." >&2
  exit 1
}

init_workspace() {
  local target_root
  target_root="$(resolve_target_root)"

  if [[ ! -d "$target_root" ]]; then
    echo "Workspace target does not exist: $target_root" >&2
    exit 1
  fi

  cd "$target_root"

  if [[ ! -f package.json ]]; then
    echo "No package.json found in workspace target: $target_root" >&2
    exit 1
  fi

  copy_worktree_includes "$target_root"
  run_pnpm_install

  if [[ ! -e .env ]]; then
    echo "No .env found, so local telemetry is unavailable. Create one from .env.example or use pnpm dev:prod."
  fi
}

case "${1:-}" in
  init)
    init_workspace
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
