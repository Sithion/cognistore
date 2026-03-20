#!/usr/bin/env bash
# PreToolUse hook: Detects when an agent tries to write a plan to a local file
# and reminds them to also use createPlan().
# Non-blocking — only adds a systemMessage.

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || true)

# If no file path found, skip
if [ -z "$FILE_PATH" ]; then
  echo '{}'
  exit 0
fi

# Check if writing to .claude/plans/ directory (plan mode)
# Plan mode generates random slugs (e.g. sorted-jumping-whistle.md) so we match the directory
case "$FILE_PATH" in
  */.claude/plans/*)
    cat <<'EOF'
{
  "systemMessage": "[CogniStore] Plan mode file detected. After writing this file, you MUST ALSO call mcp__cognistore__createPlan() to persist the plan in the knowledge base with title, content, tags, scope, and tasks array. The local plan file is temporary — createPlan() is the source of truth."
}
EOF
    exit 0
    ;;
esac

# Extract just the filename (lowercase)
FILENAME=$(basename "$FILE_PATH" | tr '[:upper:]' '[:lower:]')

# Check if the filename looks like a plan file
case "$FILENAME" in
  plan.md|plan.txt|plans.md|implementation-plan.md|implementation_plan.md|todo-plan.md|task-plan.md|roadmap.md|*.plan.md)
    cat <<'EOF'
{
  "systemMessage": "[CogniStore] WARNING: You are writing to a file that looks like a plan. Plans MUST also be created via mcp__cognistore__createPlan(). Use createPlan() with a tasks array. Local plan files are not tracked, searchable, or visible in the dashboard."
}
EOF
    exit 0
    ;;
esac

echo '{}'
exit 0
