#!/usr/bin/env bash
# PostToolUse hook: Fires after ExitPlanMode to ENFORCE plan persistence
# in the knowledge base. Plans MUST go through createPlan().

set -euo pipefail

cat <<'EOF'
{
  "systemMessage": "[CogniStore] Plan approved. Call mcp__cognistore__createPlan() NOW — title, content, tags, scope: \"workspace:<project>\", tasks array with every step. The local plan file is temporary; createPlan() is the persistent source of truth."
}
EOF

exit 0
