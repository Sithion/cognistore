#!/usr/bin/env bash
# PostToolUse hook: Fires after ExitPlanMode to ENFORCE plan persistence
# in the knowledge base. Plans MUST go through createPlan().

set -euo pipefail

cat <<'EOF'
{
  "systemMessage": "[CogniStore] Plan mode ended. If you did NOT call createPlan() before ExitPlanMode, call it NOW — title, content, tags, scope, tasks array. Then track execution: updatePlanTask(taskId, {status: 'in_progress'}) BEFORE each task, updatePlanTask(taskId, {status: 'completed'}) AFTER."
}
EOF

exit 0
