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

# Remove CLI binary
if [ -f "$INSTALL_DIR/$BINARY_NAME" ]; then
  rm -f "$INSTALL_DIR/$BINARY_NAME"
  echo "Removed binary: $INSTALL_DIR/$BINARY_NAME"
fi

# Remove authorizations and config, but preserve user preferences
if [ -d ~/.lightsprint ]; then
  # Remove everything except preferences.json
  find ~/.lightsprint -maxdepth 1 -type f ! -name 'preferences.json' -delete
  # Remove subdirectories
  find ~/.lightsprint -maxdepth 1 -type d ! -path ~/.lightsprint -exec rm -rf {} +
  echo "Removed authorizations and config from ~/.lightsprint (user preferences preserved)"
  # Clean up directory if only preferences.json remains or it's empty
  if [ -z "$(ls -A ~/.lightsprint 2>/dev/null)" ]; then
    rmdir ~/.lightsprint
  fi
fi

echo ""
echo "Done! Lightsprint plugin has been removed."
echo ""
