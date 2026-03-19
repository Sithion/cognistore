#!/usr/bin/env bash
# PreToolUse hook: Detects when an agent tries to write a plan to a local file
# and reminds them to use createPlan() instead.
# Non-blocking — only adds a systemMessage.

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || true)

# If no file path found, skip
if [ -z "$FILE_PATH" ]; then
  echo '{}'
  exit 0
fi

# Extract just the filename (lowercase)
FILENAME=$(basename "$FILE_PATH" | tr '[:upper:]' '[:lower:]')

# Check if the filename looks like a plan file
case "$FILENAME" in
  plan.md|plan.txt|plans.md|implementation-plan.md|implementation_plan.md|todo-plan.md|task-plan.md|roadmap.md|*.plan.md)
    cat <<'EOF'
{
  "systemMessage": "[AI Knowledge] WARNING: You are writing to a file that looks like a plan. Plans MUST be created via mcp__ai-knowledge__createPlan() — NEVER as local files. Use createPlan() with a tasks array instead. Local plan files will not be tracked, searchable, or visible in the dashboard."
}
EOF
    exit 0
    ;;
esac

echo '{}'
exit 0
