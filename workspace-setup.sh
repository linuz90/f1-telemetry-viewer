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

  run_pnpm_install

  if [[ ! -e .env ]]; then
    echo "No .env found. Managed worktrees copy it via .worktreeinclude when it exists in the source checkout."
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
