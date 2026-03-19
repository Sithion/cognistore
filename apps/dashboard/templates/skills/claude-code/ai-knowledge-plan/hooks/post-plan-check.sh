#!/usr/bin/env bash
# PostToolUse hook: Fires after ExitPlanMode to remind the agent
# to persist the plan in the knowledge base with tasks.

set -euo pipefail

cat <<'EOF'
{
  "systemMessage": "[AI Knowledge] MANDATORY:\n1. Save this plan using createPlan() with a tasks array for each implementation step.\n2. During execution, mark tasks in_progress → completed via updatePlanTask().\n3. When ALL tasks are completed, verify with listPlanTasks() and set plan status to 'completed'.\n4. If the plan has no tasks, create them immediately with addPlanTask()."
}
EOF

exit 0
