#!/bin/bash
# Wrapper for review-plan hook.
# Claude Code hooks don't pipe stdin directly to node/bun binaries.
# Save stdin to a temp file, then pass the file path as an argument
# (avoids stdin issues entirely — works with both node and compiled binaries).
STDIN_FILE=$(mktemp)
trap 'rm -f "$STDIN_FILE"' EXIT
cat > "$STDIN_FILE"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Bun compiled binaries can hang in Claude hook context; prefer node script.
if command -v node &>/dev/null; then
  BINARY_CMD=("node" "$SCRIPT_DIR/review-plan.js" "$STDIN_FILE")
elif [[ -x "$SCRIPT_DIR/../bin/lightsprint-plan-review" ]]; then
  BINARY_CMD=("$SCRIPT_DIR/../bin/lightsprint-plan-review" "$STDIN_FILE")
elif command -v lightsprint-plan-review &>/dev/null; then
  BINARY_CMD=("lightsprint-plan-review" "$STDIN_FILE")
else
  exit 1
fi

"${BINARY_CMD[@]}"
RC=$?

exit "$RC"
