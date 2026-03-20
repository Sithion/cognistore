#!/usr/bin/env bash
# UserPromptSubmit hook: Fires IMMEDIATELY when the user sends a message,
# BEFORE the agent starts thinking or using any tools.
# This is the earliest possible point to remind about knowledge queries.
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

cat <<'EOF'
{
  "systemMessage": "[CogniStore] MANDATORY — BEFORE doing ANYTHING else, your FIRST action MUST be:\n\nmcp__cognistore__getKnowledge(query: \"<describe the user's task or problem>\")\n\nThis query costs ~30 tokens. Skipping it risks wasting 2,000-8,000 tokens rediscovering what's already known.\n\nIf the user's message contains 3+ action steps or sequential tasks, call createPlan() BEFORE starting execution.\n\nIf you produce 2+ ordered implementation steps (in ANY mode), call createPlan() to persist them.\n\nIf executing an existing plan, you MUST track every task:\n- updatePlanTask(taskId, {status: 'in_progress'}) BEFORE starting each task\n- updatePlanTask(taskId, {status: 'completed', notes: '...'}) AFTER finishing\n- When all done → listPlanTasks(planId) → updatePlan(planId, {status: 'completed'})"
}
EOF

exit 0
