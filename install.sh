#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/pc-style/vcx.git"
APP_NAME="vcx"
INSTALL_DIR="${VCX_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/vcx}"
BIN_DIR="${VCX_BIN_DIR:-$HOME/.local/bin}"
BIN_PATH="$BIN_DIR/$APP_NAME"
YES=0

usage() {
  cat <<'EOF'
Install vcx, a QoL wrapper around the Vercel CLI.

Usage:
  install.sh [--yes] [--dir <path>] [--bin-dir <path>]

Options:
  -y, --yes          Run non-interactively.
      --dir PATH     Install/update repo at PATH.
      --bin-dir PATH Symlink vcx into PATH.
  -h, --help         Show this help.

Environment:
  VCX_INSTALL_DIR    Default install directory.
  VCX_BIN_DIR        Default bin directory.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      YES=1
      shift
      ;;
    --dir)
      INSTALL_DIR="${2:-}"
      [[ -n "$INSTALL_DIR" ]] || { echo "--dir requires a path" >&2; exit 1; }
      shift 2
      ;;
    --bin-dir)
      BIN_DIR="${2:-}"
      [[ -n "$BIN_DIR" ]] || { echo "--bin-dir requires a path" >&2; exit 1; }
      BIN_PATH="$BIN_DIR/$APP_NAME"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

has() {
  command -v "$1" >/dev/null 2>&1
}

say() {
  if has gum; then
    gum style --foreground 212 --bold "$*"
  else
    printf '%s\n' "$*"
  fi
}

note() {
  printf '%s\n' "$*"
}

confirm() {
  local prompt="$1"
  if [[ "$YES" == "1" || ! -t 0 ]]; then
    return 0
  fi

  if has gum; then
    gum confirm "$prompt"
    return $?
  fi

  local answer
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" || "$answer" == "yes" || "$answer" == "YES" ]]
}

run_step() {
  local title="$1"
  shift
  if has gum; then
    gum spin --show-output --title "$title" -- "$@"
  else
    note "==> $title"
    "$@"
  fi
}

require() {
  if ! has "$1"; then
    echo "Missing required command: $1" >&2
    case "$1" in
      bun)
        echo "Install Bun first: curl -fsSL https://bun.sh/install | bash" >&2
        ;;
      git)
        echo "Install Git first, then re-run this installer." >&2
        ;;
    esac
    exit 1
  fi
}

case "$(uname -s)" in
  Darwin|Linux) ;;
  *)
    echo "Unsupported OS: $(uname -s). vcx installer currently supports macOS and Linux." >&2
    exit 1
    ;;
esac

require git
require bun

say "Install vcx"
note "Repo:        $REPO_URL"
note "Install dir: $INSTALL_DIR"
note "Binary:      $BIN_PATH"
note ""

if ! confirm "Proceed with install/update?"; then
  note "Cancelled."
  exit 0
fi

mkdir -p "$BIN_DIR"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  run_step "Updating vcx" git -C "$INSTALL_DIR" pull --ff-only
elif [[ -e "$INSTALL_DIR" ]]; then
  echo "$INSTALL_DIR exists but is not a git checkout. Set VCX_INSTALL_DIR or pass --dir." >&2
  exit 1
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  run_step "Cloning vcx" git clone "$REPO_URL" "$INSTALL_DIR"
fi

run_step "Installing dependencies" bun install --cwd "$INSTALL_DIR"
run_step "Building vcx" bun run --cwd "$INSTALL_DIR" build

ln -sfn "$INSTALL_DIR/dist/index.js" "$BIN_PATH"
chmod +x "$INSTALL_DIR/dist/index.js"

say "vcx installed"
note "Run: $BIN_PATH --help"

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  note ""
  note "Add this to your shell profile if vcx is not found:"
  note "  export PATH=\"$BIN_DIR:\$PATH\""
fi
