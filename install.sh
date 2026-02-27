#!/usr/bin/env bash
set -euo pipefail

REPO="SprintsAI/lightsprint-claude-code-plugin"
MARKETPLACE_NAME="lightsprint"
PLUGIN_NAME="lightsprint"
PLUGIN_DIR="$HOME/.claude/plugins/marketplaces/lightsprint"
BINARY_NAME="lightsprint-plan-review"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local}/bin"

echo "Installing Lightsprint for Claude Code..."

# Accept base URL from env or CLI arg (default: https://lightsprint.ai)
LIGHTSPRINT_BASE_URL="${LIGHTSPRINT_BASE_URL:-https://lightsprint.ai}"
for arg in "$@"; do
  case "$arg" in
    --base-url=*) LIGHTSPRINT_BASE_URL="${arg#*=}" ;;
  esac
done
export LIGHTSPRINT_BASE_URL

# Persist base URL so hooks can read it later (survives across sessions)
LIGHTSPRINT_CONFIG_DIR="$HOME/.lightsprint"
mkdir -p "$LIGHTSPRINT_CONFIG_DIR"
printf '{"baseUrl":"%s"}\n' "$LIGHTSPRINT_BASE_URL" > "$LIGHTSPRINT_CONFIG_DIR/config.json"

# Check prerequisites
if ! command -v claude &>/dev/null; then
  echo "Error: claude CLI not found. Install it first: https://docs.anthropic.com/en/docs/claude-code" >&2
  exit 1
fi

# Remove previous installation (idempotent)
claude plugin uninstall "$PLUGIN_NAME" 2>/dev/null || true
claude plugin marketplace remove "$MARKETPLACE_NAME" 2>/dev/null || true

# ─── Install plan review binary ──────────────────────────────────────────
install_binary() {
  if [[ -n "${LIGHTSPRINT_LOCAL_PATH:-}" ]]; then
    # Local dev mode: compile from source with Bun into plugin's bin/ dir
    local SRC_DIR PLUGIN_BIN_DIR
    SRC_DIR="$(cd "$LIGHTSPRINT_LOCAL_PATH" && pwd)"
    PLUGIN_BIN_DIR="$SRC_DIR/bin"
    mkdir -p "$PLUGIN_BIN_DIR"
    if command -v bun &>/dev/null; then
      echo "Compiling plan review binary from local source..."
      (cd "$SRC_DIR" && bun build scripts/review-plan.js --compile --outfile "$PLUGIN_BIN_DIR/$BINARY_NAME") || {
        echo "Warning: Failed to compile binary. Plan review hook will not be available." >&2
        return 1
      }
    else
      echo "Warning: bun not found. Skipping binary compilation." >&2
      echo "  Install Bun (https://bun.sh) for local development, or use a release build." >&2
      return 1
    fi
    chmod +x "$PLUGIN_BIN_DIR/$BINARY_NAME"
    echo "Installed $BINARY_NAME to $PLUGIN_BIN_DIR/"

    # Optional: copy to ~/.local/bin for CLI convenience
    mkdir -p "$INSTALL_DIR"
    cp "$PLUGIN_BIN_DIR/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME" 2>/dev/null && \
      echo "Also copied to $INSTALL_DIR/ for CLI convenience" || true
  else
    # Production mode: download pre-compiled binary from GitHub releases
    # Binary goes into the plugin cache bin/ directory
    echo "Downloading plan review binary..."

    # Detect platform
    local OS ARCH PLATFORM
    OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
    ARCH="$(uname -m)"
    case "$ARCH" in
      x86_64) ARCH="x64" ;;
      aarch64|arm64) ARCH="arm64" ;;
      *) echo "Error: Unsupported architecture: $ARCH" >&2; return 1 ;;
    esac
    PLATFORM="${OS}-${ARCH}"

    # Get latest release tag
    local TAG
    local RELEASE_JSON
    RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest") || {
      echo "Warning: Could not fetch latest release. Plan review hook will not be available." >&2
      return 1
    }
    if command -v jq &>/dev/null; then
      TAG=$(echo "$RELEASE_JSON" | jq -r '.tag_name')
    else
      TAG=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | cut -d'"' -f4)
    fi
    if [[ -z "$TAG" || "$TAG" == "null" ]]; then
      echo "Warning: Could not parse release tag. Plan review hook will not be available." >&2
      return 1
    fi

    # Determine plugin cache bin/ directory
    local VERSION PLUGIN_BIN_DIR
    VERSION="${TAG#v}"  # strip leading 'v' if present
    PLUGIN_BIN_DIR="$HOME/.claude/plugins/cache/lightsprint/lightsprint/${VERSION}/bin"
    mkdir -p "$PLUGIN_BIN_DIR"

    local DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/$BINARY_NAME-$PLATFORM"
    local CHECKSUM_URL="https://github.com/$REPO/releases/download/$TAG/$BINARY_NAME-$PLATFORM.sha256"

    curl -fsSL -o "$PLUGIN_BIN_DIR/$BINARY_NAME" "$DOWNLOAD_URL" || {
      echo "Warning: Failed to download binary. Plan review hook will not be available." >&2
      return 1
    }

    # Verify checksum if available
    local TMP_CHECKSUM
    TMP_CHECKSUM=$(mktemp)
    if curl -fsSL -o "$TMP_CHECKSUM" "$CHECKSUM_URL" 2>/dev/null; then
      local EXPECTED ACTUAL
      EXPECTED=$(awk '{print $1}' "$TMP_CHECKSUM")
      if command -v sha256sum &>/dev/null; then
        ACTUAL=$(sha256sum "$PLUGIN_BIN_DIR/$BINARY_NAME" | awk '{print $1}')
      elif command -v shasum &>/dev/null; then
        ACTUAL=$(shasum -a 256 "$PLUGIN_BIN_DIR/$BINARY_NAME" | awk '{print $1}')
      else
        echo "Warning: No checksum tool found, skipping verification." >&2
        rm -f "$TMP_CHECKSUM"
        return 0
      fi
      rm -f "$TMP_CHECKSUM"
      if [[ "$EXPECTED" != "$ACTUAL" ]]; then
        echo "Error: Checksum verification failed!" >&2
        rm -f "$PLUGIN_BIN_DIR/$BINARY_NAME"
        return 1
      fi
    else
      rm -f "$TMP_CHECKSUM"
    fi

    chmod +x "$PLUGIN_BIN_DIR/$BINARY_NAME"
    echo "Installed $BINARY_NAME to $PLUGIN_BIN_DIR/"

    # Optional: copy to ~/.local/bin for CLI convenience
    mkdir -p "$INSTALL_DIR"
    cp "$PLUGIN_BIN_DIR/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME" 2>/dev/null && \
      echo "Also copied to $INSTALL_DIR/ for CLI convenience" || true
  fi

  return 0
}

install_binary || true

# ─── Install plugin (skills + PostToolUse hooks) ─────────────────────────
echo "Installing plugin..."
if [[ -n "${LIGHTSPRINT_LOCAL_PATH:-}" ]]; then
  LIGHTSPRINT_LOCAL_PATH="$(cd "$LIGHTSPRINT_LOCAL_PATH" && pwd)"
  echo "Using local path: $LIGHTSPRINT_LOCAL_PATH"
  mkdir -p "$(dirname "$PLUGIN_DIR")"
  ln -sfn "$LIGHTSPRINT_LOCAL_PATH" "$PLUGIN_DIR"
  echo "Adding marketplace from local symlink..."
  claude plugin marketplace add "$PLUGIN_DIR" || {
    echo "Error: Failed to add Lightsprint marketplace from local path" >&2
    exit 1
  }
else
  claude plugin marketplace add "$REPO" || {
    echo "Error: Failed to add Lightsprint marketplace" >&2
    exit 1
  }
fi

claude plugin install "$PLUGIN_NAME" || {
  echo "Error: Failed to install Lightsprint plugin" >&2
  exit 1
}

echo ""
echo "Plugin installed successfully."
if [[ "$LIGHTSPRINT_BASE_URL" != "https://lightsprint.ai" ]]; then
  echo "Base URL: $LIGHTSPRINT_BASE_URL"
fi

# Check if INSTALL_DIR is in PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo ""
  echo "Note: $INSTALL_DIR is not in your PATH."
  echo "  Add it with: export PATH=\"$INSTALL_DIR:\$PATH\""
fi
echo ""

# ─── Interactive project connection ───────────────────────────────────────

CURRENT_DIR="$(pwd)"

REPO_FULL_NAME=""
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
  if [[ -n "$REMOTE_URL" ]]; then
    CLEANED="${REMOTE_URL%.git}"
    CLEANED="${CLEANED##*github.com/}"
    CLEANED="${CLEANED##*github.com:}"
    if [[ "$CLEANED" == *"/"* && "$CLEANED" != "$REMOTE_URL" ]]; then
      REPO_FULL_NAME="$CLEANED"
    fi
  fi
fi

if [[ -n "$REPO_FULL_NAME" ]]; then
  echo "─────────────────────────────────────────"
  echo "  Connect this folder to a project on Lightsprint?"
  echo "─────────────────────────────────────────"
  echo ""
  echo "  Folder: $CURRENT_DIR"
  echo "  Repo:   $REPO_FULL_NAME"
  echo ""

  if [[ -t 0 ]]; then
    read -rp "Connect? (Y/n) " CONFIRM
    CONFIRM="${CONFIRM:-Y}"
  else
    CONFIRM="Y"
  fi

  if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo ""
    node "$PLUGIN_DIR/scripts/ls-cli.js" connect </dev/tty
  else
    echo ""
    echo "Skipped. You can connect later by using any /lightsprint: command."
  fi
else
  echo "─────────────────────────────────────────"
  echo "  No git repository detected"
  echo "─────────────────────────────────────────"
  echo ""
  echo "  To connect a project to Lightsprint, open Claude Code"
  echo "  inside a git repository and run:"
  echo ""
  echo "    /lightsprint:tasks"
  echo ""
  echo "  This will trigger the OAuth flow and link that project."
fi

echo ""
echo "Done!"
echo ""
