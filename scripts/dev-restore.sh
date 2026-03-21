#!/usr/bin/env bash
# Restore plugin config to production after dev-local.sh.
#
# What it does:
#   1. Restores ~/.lightsprint/config.json and repos.json from backup
#   2. Removes the backup directory
#
# Does NOT rebuild the binary — run `npm run build` if you also want to
# restore the binary to the latest released version.

set -euo pipefail

CONFIG_DIR="${HOME}/.lightsprint"
BACKUP_DIR="${CONFIG_DIR}/.dev-backup"

if [ ! -d "${BACKUP_DIR}" ]; then
  echo "No backup found at ${BACKUP_DIR} — nothing to restore."
  echo "(Was dev-local.sh run first?)"
  exit 1
fi

echo "==> Restoring production config..."

if [ -f "${BACKUP_DIR}/config.json" ]; then
  cp "${BACKUP_DIR}/config.json" "${CONFIG_DIR}/config.json"
  echo "    Restored config.json"
fi

if [ -f "${BACKUP_DIR}/repos.json" ]; then
  cp "${BACKUP_DIR}/repos.json" "${CONFIG_DIR}/repos.json"
  echo "    Restored repos.json"
fi

rm -rf "${BACKUP_DIR}"

echo ""
echo "==> Done. Plugin restored to production config."
echo ""
echo "    To also restore the binary to the released version, re-run:"
echo "      npx lightsprint"
