#!/bin/bash
# Wrapper for review-plan hook.
# Claude Code hooks don't pipe stdin directly to node/bun binaries.
# Save stdin to a temp file, then pass the file path as an argument
# (avoids stdin issues entirely — works with both node and compiled binaries).
STDIN_FILE=$(mktemp)
trap 'rm -f "$STDIN_FILE"' EXIT
cat > "$STDIN_FILE"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRACE_FILE="/tmp/lightsprint-hook-e2e108.log"

# #region agent log
{
  echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) event=wrapper_start pid=$$ script_dir=$SCRIPT_DIR stdin_file=$STDIN_FILE"
} >> "$TRACE_FILE" 2>/dev/null || true
# #endregion

# Bun compiled binaries can hang in Claude hook context; prefer node script.
if command -v node &>/dev/null; then
  # #region agent log
  {
    echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) event=exec_node path=$SCRIPT_DIR/review-plan.js"
  } >> "$TRACE_FILE" 2>/dev/null || true
  # #endregion
  BINARY_CMD=("node" "$SCRIPT_DIR/review-plan.js" "$STDIN_FILE")
elif [[ -x "$SCRIPT_DIR/../bin/lightsprint-plan-review" ]]; then
  # #region agent log
  {
    echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) event=exec_binary_fallback path=$SCRIPT_DIR/../bin/lightsprint-plan-review"
  } >> "$TRACE_FILE" 2>/dev/null || true
  # #endregion
  BINARY_CMD=("$SCRIPT_DIR/../bin/lightsprint-plan-review" "$STDIN_FILE")
elif command -v lightsprint-plan-review &>/dev/null; then
  # #region agent log
  {
    echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) event=exec_path_binary_fallback"
  } >> "$TRACE_FILE" 2>/dev/null || true
  # #endregion
  BINARY_CMD=("lightsprint-plan-review" "$STDIN_FILE")
else
  # #region agent log
  {
    echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) event=no_runtime_available"
  } >> "$TRACE_FILE" 2>/dev/null || true
  # #endregion
  exit 1
fi

# #region agent log
{
  echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) event=before_exec stdin_exists=$(test -f "$STDIN_FILE" && echo yes || echo no) stdin_size=$(wc -c < "$STDIN_FILE" 2>/dev/null || echo 0)"
} >> "$TRACE_FILE" 2>/dev/null || true
# #endregion

"${BINARY_CMD[@]}"
RC=$?

# #region agent log
{
  echo "ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) event=after_exec rc=$RC"
} >> "$TRACE_FILE" 2>/dev/null || true
# #endregion

exit "$RC"
