#!/usr/bin/env bash
set -euo pipefail

REPO="SprintsAI/lightsprint-claude-code-plugin"
MARKETPLACE_NAME="lightsprint"
PLUGIN_NAME="lightsprint"
BASE_URL="${LIGHTSPRINT_BASE_URL:-https://lightsprint.ai}"

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

# Find free port for callback
PORT=$(node -e "const s=require('net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})")

# Open browser for auth
AUTHORIZE_URL="${BASE_URL}/authorize-cli?port=${PORT}&scope=tasks:read+tasks:write+kanban:read+comments:write"
echo "Opening browser to authorize..."
open "$AUTHORIZE_URL" 2>/dev/null || xdg-open "$AUTHORIZE_URL" 2>/dev/null || {
  echo "Please open this URL in your browser:"
  echo "  $AUTHORIZE_URL"
}

# Wait for callback with tokens (2 minute timeout)
RESULT=$(node -e "
const http = require('http');
const s = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/callback') {
    const accessToken = url.searchParams.get('access_token');
    const refreshToken = url.searchParams.get('refresh_token');
    const expiresIn = url.searchParams.get('expires_in');
    const project = url.searchParams.get('project');
    const projectId = url.searchParams.get('project_id');
    res.writeHead(200, {'Content-Type':'text/html'});
    res.end('<html><body style=\"font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0\"><div style=\"text-align:center\"><h1>Authorized!</h1><p>You can close this tab and return to your terminal.</p></div></body></html>');
    console.log(JSON.stringify({accessToken, refreshToken, expiresIn, project, projectId}));
    s.close();
  }
});
s.listen(${PORT});
setTimeout(() => { console.error('Timed out waiting for authorization'); s.close(); process.exit(1); }, 120000);
")

if [ -z "$RESULT" ]; then
  echo "Error: Authorization failed or timed out." >&2
  exit 1
fi

# Store per-folder config
FOLDER=$(pwd)
mkdir -p ~/.lightsprint
node -e "
const fs = require('fs');
const path = require('path');
const result = JSON.parse(process.argv[1]);
const p = path.join(require('os').homedir(), '.lightsprint', 'projects.json');
const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,'utf8')) : {};
data[process.argv[2]] = {
  accessToken: result.accessToken,
  refreshToken: result.refreshToken,
  expiresAt: Date.now() + (parseInt(result.expiresIn) * 1000),
  projectId: result.projectId,
  projectName: result.project
};
fs.writeFileSync(p, JSON.stringify(data, null, 2));
" "$RESULT" "$FOLDER"

# Extract project name for display
PROJECT=$(node -e "console.log(JSON.parse(process.argv[1]).project)" "$RESULT")

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
echo "Done! Lightsprint connected to project: ${PROJECT}"
echo "Hooks and skills are now active in this folder."
echo ""
