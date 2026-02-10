#!/usr/bin/env bash
set -euo pipefail

REPO="SprintsAI/lightsprint-claude-code-plugin"

echo "Installing Lightsprint plugin for Claude Code..."

if ! command -v claude &>/dev/null; then
  echo "Error: claude CLI not found. Install it first: https://docs.anthropic.com/en/docs/claude-code" >&2
  exit 1
fi

echo "Adding Lightsprint marketplace..."
claude plugin marketplace add "$REPO" || {
  echo "Error: Failed to add Lightsprint marketplace" >&2
  exit 1
}

echo "Installing lightsprint plugin..."
claude plugin install lightsprint

echo ""
echo "Done! Set your API key to get started:"
echo ""
echo "  export LIGHTSPRINT_API_KEY=ls_pk_..."
echo ""
