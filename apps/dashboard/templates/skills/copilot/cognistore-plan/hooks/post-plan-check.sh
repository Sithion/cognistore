#!/usr/bin/env bash
# PostToolUse hook: Fires after plan-related actions to ENFORCE plan persistence
# in the knowledge base. Plans MUST go through createPlan().

set -euo pipefail

cat <<'EOF'
{
  "systemMessage": "[CogniStore] Plan mode ended. If you did NOT call createPlan() before exiting, call it NOW. Then track execution: updatePlanTask(taskId, {status: 'in_progress'}) BEFORE each task, updatePlanTask(taskId, {status: 'completed', notes: '...'}) AFTER."
}
EOF

exit 0
