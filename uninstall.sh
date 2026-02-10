#!/usr/bin/env bash
set -euo pipefail

REPO="SprintsAI/lightsprint-claude-code-plugin"

echo "Uninstalling Lightsprint plugin for Claude Code..."

if ! command -v claude &>/dev/null; then
  echo "Error: claude CLI not found." >&2
  exit 1
fi

echo "Removing lightsprint plugin..."
claude plugin uninstall lightsprint 2>/dev/null || true

echo "Removing Lightsprint marketplace..."
claude plugin marketplace remove "$REPO" 2>/dev/null || true

echo "Cleaning up local data..."
rm -rf ~/.lightsprint

echo ""
echo "Done! Lightsprint plugin has been fully removed."
echo ""
