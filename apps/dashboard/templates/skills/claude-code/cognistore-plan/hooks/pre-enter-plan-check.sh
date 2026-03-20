#!/usr/bin/env bash
set -euo pipefail
cat <<'EOF'
{
  "systemMessage": "[CogniStore] Planning detected. 1) getKnowledge() first. 2) Write your plan file. 3) Call createPlan() BEFORE ExitPlanMode (MCP tools work in plan mode). 4) Then ExitPlanMode. 5) During execution: updatePlanTask() for EVERY task (in_progress → completed)."
}
EOF
exit 0
