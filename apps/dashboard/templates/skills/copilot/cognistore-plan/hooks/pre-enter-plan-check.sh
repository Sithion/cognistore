#!/usr/bin/env bash
set -euo pipefail
cat <<'EOF'
{
  "systemMessage": "[CogniStore] Planning: 1) getKnowledge() first, 2) Write plan, 3) createPlan() BEFORE exiting plan mode (MCP tools work in plan mode), 4) Exit plan mode, 5) updatePlanTask() for EVERY task (in_progress → completed)."
}
EOF
exit 0
