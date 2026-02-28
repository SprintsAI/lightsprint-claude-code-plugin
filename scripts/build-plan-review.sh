#!/usr/bin/env bash
# Build plan-review binary with version hash for log verification.
set -euo pipefail
HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "nobuild")
echo "Building with hash: $HASH"
exec bun build scripts/review-plan.js \
  --compile \
  --outfile lightsprint-plan-review \
  --define "__BUILD_HASH__=\"$HASH\""
