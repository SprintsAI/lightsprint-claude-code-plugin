#!/usr/bin/env bash
set -euo pipefail

REPO="SprintsAI/lightsprint-claude-code-plugin"
MARKETPLACE_NAME="lightsprint"
PLUGIN_NAME="lightsprint"

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
echo "Done! Lightsprint plugin installed."
echo "Use any /lightsprint: command (e.g. /lightsprint:kanban) to connect your project."
echo ""
