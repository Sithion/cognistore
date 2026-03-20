#!/usr/bin/env bash
# PostToolUse hook: Fires after plan-related actions to ENFORCE plan persistence
# in the knowledge base. Plans MUST go through createPlan().

set -euo pipefail

cat <<'EOF'
{
  "systemMessage": "[CogniStore] If you have a plan: track execution — updatePlanTask(taskId, {status: 'in_progress'}) BEFORE each task, updatePlanTask(taskId, {status: 'completed', notes: '...'}) AFTER. If plan not yet created: call createPlan() NOW with title, content, tags, scope, tasks array."
}
EOF

exit 0
