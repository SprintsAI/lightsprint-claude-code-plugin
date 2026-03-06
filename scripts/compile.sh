#!/usr/bin/env bash
# Build lightsprint binary with version hash for log verification.
set -euo pipefail
HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "nobuild")
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")
BUILD_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
echo "Building v${VERSION} (${HASH}) at ${BUILD_TIME}"
bun build scripts/lightsprint.js \
  --compile \
  --outfile lightsprint \
  --define "__BUILD_HASH__=\"$HASH\"" \
  --define "__BUILD_VERSION__=\"$VERSION\"" \
  --define "__BUILD_TIME__=\"$BUILD_TIME\""

# Re-sign on macOS (Bun compile invalidates the Mach-O signature)
if [[ "$(uname)" == "Darwin" ]]; then
  codesign --force --sign - lightsprint 2>/dev/null && echo "Signed binary (ad-hoc)"
fi

# Auto-install to PATH in dev mode
INSTALL_DIR="$HOME/.local/bin"
if [ -d "$INSTALL_DIR" ]; then
  cp lightsprint "$INSTALL_DIR/lightsprint"
  # Re-sign after copy (cp invalidates the signature)
  if [[ "$(uname)" == "Darwin" ]]; then
    codesign --force --sign - "$INSTALL_DIR/lightsprint" 2>/dev/null
  fi
  echo "Installed to $INSTALL_DIR/lightsprint"
fi
