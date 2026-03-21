#!/usr/bin/env bash
# Switch the plugin to use a local Lightsprint server (http://localhost:5173)
# and build+install the binary from the current source tree.
#
# Usage: ./scripts/dev-local.sh [port]   (default: 5173)
#
# What it does:
#   1. Backs up ~/.lightsprint/config.json and repos.json
#   2. Rewrites baseUrl in both files to http://localhost:<port>
#   3. Builds the binary from source (bun build --compile)
#   4. Installs to ~/.local/bin/lightsprint
#
# To undo: ./scripts/dev-restore.sh

set -euo pipefail

PORT="${1:-5173}"
LOCAL_URL="http://localhost:${PORT}"
CONFIG_DIR="${HOME}/.lightsprint"
CONFIG_FILE="${CONFIG_DIR}/config.json"
REPOS_FILE="${CONFIG_DIR}/repos.json"
BACKUP_DIR="${CONFIG_DIR}/.dev-backup"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==> Switching to local server: ${LOCAL_URL}"

# ── 1. Back up current config ────────────────────────────────────────────────

mkdir -p "${BACKUP_DIR}"

if [ -f "${CONFIG_FILE}" ]; then
  cp "${CONFIG_FILE}" "${BACKUP_DIR}/config.json"
  echo "    Backed up config.json"
fi

if [ -f "${REPOS_FILE}" ]; then
  cp "${REPOS_FILE}" "${BACKUP_DIR}/repos.json"
  echo "    Backed up repos.json"
fi

# ── 2. Rewrite baseUrl to localhost ──────────────────────────────────────────

# config.json — simple key
if [ -f "${CONFIG_FILE}" ]; then
  # Use node for reliable JSON manipulation
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('${CONFIG_FILE}', 'utf-8'));
    cfg.baseUrl = '${LOCAL_URL}';
    fs.writeFileSync('${CONFIG_FILE}', JSON.stringify(cfg, null, 2) + '\n');
  "
  echo "    config.json → baseUrl: ${LOCAL_URL}"
else
  echo '{"baseUrl":"'"${LOCAL_URL}"'"}' > "${CONFIG_FILE}"
  echo "    Created config.json with baseUrl: ${LOCAL_URL}"
fi

# repos.json — rewrite baseUrl for every repo entry
if [ -f "${REPOS_FILE}" ]; then
  node -e "
    const fs = require('fs');
    const repos = JSON.parse(fs.readFileSync('${REPOS_FILE}', 'utf-8'));
    for (const key of Object.keys(repos)) {
      if (repos[key].baseUrl) repos[key].baseUrl = '${LOCAL_URL}';
    }
    fs.writeFileSync('${REPOS_FILE}', JSON.stringify(repos, null, 2) + '\n');
  "
  echo "    repos.json → all baseUrls: ${LOCAL_URL}"
fi

# ── 3. Build from source ────────────────────────────────────────────────────

echo ""
echo "==> Building binary from source..."
cd "${PROJECT_DIR}"
bash scripts/compile.sh

# ── 4. Done ──────────────────────────────────────────────────────────────────

echo ""
echo "==> Done. Plugin now points at ${LOCAL_URL}"
echo "    Binary installed from: ${PROJECT_DIR}"
echo "    Run ./scripts/dev-restore.sh to switch back to production."
echo ""
echo "    Tail logs:  tail -f ~/.lightsprint/daemon.log"
