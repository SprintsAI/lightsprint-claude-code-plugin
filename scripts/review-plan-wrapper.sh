#!/bin/bash
# Wrapper for review-plan hook.
# Claude Code hooks don't pipe stdin directly to node/bun binaries.
# Save stdin to a temp file, then pass the file path as an argument
# (avoids stdin issues entirely — works with both node and compiled binaries).
STDIN_FILE=$(mktemp)
cat > "$STDIN_FILE"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Resolve binary: prefer plugin's own bin/ directory, fall back to PATH
BINARY="$SCRIPT_DIR/../bin/lightsprint-plan-review"
if [[ ! -x "$BINARY" ]]; then
  BINARY="lightsprint-plan-review"
fi

"$BINARY" "$STDIN_FILE"
RC=$?
rm -f "$STDIN_FILE"
exit $RC
