#!/usr/bin/env bash
set -euo pipefail

REPO="SprintsAI/lightsprint-claude-code-plugin"
MARKETPLACE_NAME="lightsprint"
PLUGIN_NAME="lightsprint"
PLUGIN_DIR="$HOME/.claude/plugins/marketplaces/lightsprint"

echo "Installing Lightsprint for Claude Code..."

# Check prerequisites
if ! command -v claude &>/dev/null; then
  echo "Error: claude CLI not found. Install it first: https://docs.anthropic.com/en/docs/claude-code" >&2
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "Error: node not found." >&2
  exit 1
fi

# Remove previous installation (idempotent)
claude plugin uninstall "$PLUGIN_NAME" 2>/dev/null || true
claude plugin marketplace remove "$MARKETPLACE_NAME" 2>/dev/null || true

# Install plugin (hooks + skills)
echo "Installing plugin..."
claude plugin marketplace add "$REPO" || {
  echo "Error: Failed to add Lightsprint marketplace" >&2
  exit 1
}

claude plugin install "$PLUGIN_NAME" || {
  echo "Error: Failed to install Lightsprint plugin" >&2
  exit 1
}

echo ""
echo "Plugin installed successfully."
echo ""

# ─── Interactive project connection ───────────────────────────────────────

# Detect current folder info
CURRENT_DIR="$(pwd)"

# Try to detect git repo
REPO_FULL_NAME=""
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
  if [[ -n "$REMOTE_URL" ]]; then
    # Extract owner/repo from SSH or HTTPS URL using pure bash (no sed)
    CLEANED="${REMOTE_URL%.git}"
    # Handle HTTPS (github.com/) and SSH (github.com:)
    CLEANED="${CLEANED##*github.com/}"
    CLEANED="${CLEANED##*github.com:}"
    # Should be "owner/repo" now
    if [[ "$CLEANED" == *"/"* && "$CLEANED" != "$REMOTE_URL" ]]; then
      REPO_FULL_NAME="$CLEANED"
    fi
  fi
fi

echo "─────────────────────────────────────────"
echo "  Connect this folder to a project on Lightsprint?"
echo "─────────────────────────────────────────"
echo ""
echo "  Folder: $CURRENT_DIR"
if [[ -n "$REPO_FULL_NAME" ]]; then
  echo "  Repo:   $REPO_FULL_NAME"
fi
echo ""

if [[ -t 0 ]]; then
  # Interactive terminal — prompt the user
  read -rp "Connect? (Y/n) " CONFIRM
  CONFIRM="${CONFIRM:-Y}"
else
  # Piped (curl | bash) — stdin is not a terminal, auto-connect
  CONFIRM="Y"
fi

if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo ""
  # Reattach stdin to the terminal so the OAuth callback server works
  node "$PLUGIN_DIR/scripts/ls-cli.js" connect </dev/tty
else
  echo ""
  echo "Skipped. You can connect later by using any /lightsprint: command."
fi

echo ""
echo "Done!"
echo ""
