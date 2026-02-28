#!/usr/bin/env bash
# Build plan-review binary with version hash for log verification.
set -euo pipefail
HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "nobuild")
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")
BUILD_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
echo "Building v${VERSION} (${HASH}) at ${BUILD_TIME}"
exec bun build scripts/review-plan.js \
  --compile \
  --outfile ls-plan \
  --define "__BUILD_HASH__=\"$HASH\"" \
  --define "__BUILD_VERSION__=\"$VERSION\"" \
  --define "__BUILD_TIME__=\"$BUILD_TIME\""
