#!/usr/bin/env bash
# PreToolUse hook: Reminds the agent to query the knowledge base before
# performing write/execute actions. Non-blocking — only adds a systemMessage.

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

# Remind the agent to query first
cat <<'EOF'
{
  "systemMessage": "[AI Knowledge] MANDATORY: You must call mcp__ai-knowledge__getKnowledge() BEFORE making changes. Query the knowledge base first to check for existing patterns, decisions, and fixes. A single query costs ~30 tokens — a missed cache hit wastes thousands on redundant work."
}
EOF

exit 0
