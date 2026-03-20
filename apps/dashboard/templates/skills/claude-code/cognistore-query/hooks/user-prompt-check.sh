#!/usr/bin/env bash
# UserPromptSubmit hook: Fires IMMEDIATELY when the user sends a message,
# BEFORE the agent starts thinking or using any tools.
# Injects system knowledge (mandatory workflow protocol) into agent context.
# Non-blocking — only adds a systemMessage.

set -euo pipefail

# Quick health check: verify knowledge DB exists
SQLITE_PATH="${SQLITE_PATH:-$HOME/.cognistore/knowledge.db}"
if [ ! -f "$SQLITE_PATH" ]; then
  cat <<'EOF'
{
  "systemMessage": "[CogniStore] WARNING: Knowledge database not found at ~/.cognistore/knowledge.db. Run the setup wizard in the CogniStore app to initialize."
}
EOF
  exit 0
fi

# Try to read system knowledge from DB
SYSTEM_CONTENT=""
if command -v sqlite3 &>/dev/null; then
  SYSTEM_CONTENT=$(sqlite3 "$SQLITE_PATH" "SELECT content FROM knowledge_entries WHERE type='system' LIMIT 1" 2>/dev/null || true)
fi

if [ -n "$SYSTEM_CONTENT" ]; then
  # Escape for JSON: replace newlines, quotes, backslashes
  ESCAPED=$(echo "$SYSTEM_CONTENT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
  cat <<ENDJSON
{
  "systemMessage": "[COGNISTORE-PROTOCOL]\n${ESCAPED}\n\n[END PROTOCOL]\n\nYour FIRST action MUST be: mcp__cognistore__getKnowledge(query: \"<describe the task>\")"
}
ENDJSON
else
  # Fallback: hardcoded reminder if sqlite3 unavailable or no system entry
  cat <<'EOF'
{
  "systemMessage": "[COGNISTORE-PROTOCOL] MANDATORY:\n1. FIRST action: mcp__cognistore__getKnowledge(query: \"<task description>\")\n2. Plans: createPlan() for 2+ steps. Lifecycle: draft → active → completed. NEVER set archived.\n3. Track tasks: updatePlanTask(in_progress) BEFORE, updatePlanTask(completed) AFTER.\n4. Capture knowledge BEFORE ending response.\n\n[END PROTOCOL]"
}
EOF
fi

exit 0
