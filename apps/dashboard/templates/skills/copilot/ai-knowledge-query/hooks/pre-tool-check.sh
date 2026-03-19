#!/usr/bin/env bash
# PreToolUse hook: Reminds the agent to query the knowledge base before
# performing write/execute actions. Includes a lightweight health check.
# Non-blocking — only adds a systemMessage.

set -euo pipefail

# Read tool info from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || true)

# Skip if the tool is an ai-knowledge MCP tool (already using knowledge base)
case "$TOOL_NAME" in
  mcp__ai-knowledge__*|mcp__ai_knowledge__*)
    echo '{}'
    exit 0
    ;;
esac

# Quick health check: verify knowledge DB exists
SQLITE_PATH="${SQLITE_PATH:-$HOME/.ai-knowledge/knowledge.db}"
if [ ! -f "$SQLITE_PATH" ]; then
  cat <<'EOF'
{
  "systemMessage": "[AI Knowledge] WARNING: Knowledge database not found. Run the setup wizard in the AI Knowledge Base app to initialize the database."
}
EOF
  exit 0
fi

# Build contextual reminder based on the tool being used
case "$TOOL_NAME" in
  edit|multi_edit|write|create)
    ACTION="editing files"
    ;;
  bash)
    ACTION="running commands"
    ;;
  *)
    ACTION="making changes"
    ;;
esac

cat <<EOF
{
  "systemMessage": "[AI Knowledge] MANDATORY: You are about to start ${ACTION} (${TOOL_NAME}). Have you queried mcp__ai-knowledge__getKnowledge() first? Check for existing patterns, decisions, and fixes before proceeding. A single query costs ~30 tokens — a missed cache hit wastes thousands on redundant work."
}
EOF

exit 0
