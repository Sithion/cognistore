#!/usr/bin/env bash
# userPromptSubmitted hook: Fires IMMEDIATELY when the user sends a message,
# BEFORE the agent starts thinking or using any tools.
# This is the earliest possible point to remind about knowledge queries.
# Non-blocking — only adds a systemMessage.

set -euo pipefail

# Quick health check: verify knowledge DB exists
SQLITE_PATH="${SQLITE_PATH:-$HOME/.ai-knowledge/knowledge.db}"
if [ ! -f "$SQLITE_PATH" ]; then
  cat <<'EOF'
{
  "systemMessage": "[AI Knowledge] WARNING: Knowledge database not found at ~/.ai-knowledge/knowledge.db. Run the setup wizard in the AI Knowledge Base app to initialize."
}
EOF
  exit 0
fi

cat <<'EOF'
{
  "systemMessage": "[AI Knowledge] MANDATORY — BEFORE doing ANYTHING else (reading files, analyzing code, making decisions, writing code), your FIRST action MUST be:\n\nmcp__ai-knowledge__getKnowledge(query: \"<describe the user's task or problem>\")\n\nThis query costs ~30 tokens. Skipping it risks wasting 2,000-8,000 tokens rediscovering what's already known.\n\nIf the task involves 3+ steps, you MUST create a plan via createPlan() — NEVER write plans to local files.\n\nIf you are continuing work on an existing plan:\n- Set plan status to 'active' via updatePlan() if not already active\n- Mark each task 'in_progress' via updatePlanTask() BEFORE starting it\n- Mark each task 'completed' AFTER finishing it — do NOT batch updates at the end\n- When all tasks are done → verify with listPlanTasks() → updatePlan(status: 'completed')"
}
EOF

exit 0
