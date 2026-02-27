#!/usr/bin/env bash
set -euo pipefail

MARKETPLACE_NAME="lightsprint"
PLUGIN_NAME="lightsprint"
BINARY_NAME="lightsprint-plan-review"
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

# Remove only the current folder's entry from projects.json
FOLDER=$(pwd)
if [ -f ~/.lightsprint/projects.json ] && command -v node &>/dev/null; then
  node -e "
const fs = require('fs');
const path = require('path');
const p = path.join(require('os').homedir(), '.lightsprint', 'projects.json');
if (fs.existsSync(p)) {
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete data[process.argv[1]];
  if (Object.keys(data).length === 0) {
    fs.unlinkSync(p);
  } else {
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  }
}
" "$FOLDER"
  echo "Removed authorization for: $FOLDER"
fi

echo ""
echo "Done! Lightsprint plugin has been removed."
echo "Note: Other folders' authorizations are preserved in ~/.lightsprint/projects.json"
echo ""
