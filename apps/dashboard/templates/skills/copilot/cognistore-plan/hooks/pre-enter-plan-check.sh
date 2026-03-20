#!/usr/bin/env bash
set -euo pipefail
cat <<'EOF'
{
  "systemMessage": "[CogniStore] Planning: 1) getKnowledge() first, 2) createPlan() with tasks array, 3) during execution: updatePlanTask() for EVERY task (in_progress → completed). Never skip task tracking."
}
EOF
exit 0
