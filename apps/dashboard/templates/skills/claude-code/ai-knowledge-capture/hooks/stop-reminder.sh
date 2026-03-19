#!/usr/bin/env bash
# Stop hook: Reminds the agent to capture knowledge after completing work.
# Non-blocking — only adds a systemMessage.

set -euo pipefail

cat <<'EOF'
{
  "systemMessage": "[AI Knowledge] MANDATORY: Before finishing, capture any new knowledge you discovered. Call mcp__ai-knowledge__addKnowledge() to store fixes, decisions, patterns, constraints, or gotchas. Every entry builds institutional memory for future sessions."
}
EOF

exit 0
