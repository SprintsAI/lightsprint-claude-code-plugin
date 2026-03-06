#!/usr/bin/env bash
set -euo pipefail

MARKETPLACE_NAME="lightsprint"
PLUGIN_NAME="lightsprint"
BINARY_NAME="lightsprint"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local}/bin"

echo "Uninstalling Lightsprint plugin for Claude Code..."

if ! command -v claude &>/dev/null; then
  echo "Error: claude CLI not found." >&2
  exit 1
fi

echo "Removing lightsprint plugin..."
claude plugin uninstall "$PLUGIN_NAME" 2>/dev/null || true

echo "Removing Lightsprint marketplace..."
claude plugin marketplace remove "$MARKETPLACE_NAME" 2>/dev/null || true

# Remove cached plugin files
CACHE_DIR="$HOME/.claude/plugins/cache/lightsprint"
if [ -d "$CACHE_DIR" ]; then
  rm -rf "$CACHE_DIR"
  echo "Removed plugin cache: $CACHE_DIR"
fi

# Remove plan review binary
if [ -f "$INSTALL_DIR/$BINARY_NAME" ]; then
  rm -f "$INSTALL_DIR/$BINARY_NAME"
  echo "Removed binary: $INSTALL_DIR/$BINARY_NAME"
fi

# Remove all authorizations and config
if [ -d ~/.lightsprint ]; then
  rm -rf ~/.lightsprint
  echo "Removed all authorizations and config: ~/.lightsprint"
fi

echo ""
echo "Done! Lightsprint plugin has been removed."
echo ""
