#!/usr/bin/env bash
# PostToolUse hook: Fires after plan-related actions to ENFORCE plan persistence
# in the knowledge base. Plans MUST go through createPlan().

set -euo pipefail

cat <<'EOF'
{
  "systemMessage": "[AI Knowledge] MANDATORY — PLAN PERSISTENCE REQUIRED:\n\nYou just finished planning. You MUST now persist this plan using createPlan().\n\n1. Call mcp__ai-knowledge__createPlan() with:\n   - title: descriptive plan name\n   - content: full plan text\n   - tags: relevant tags\n   - scope: workspace:<project-name>\n   - tasks: array with EVERY implementation step\n\n2. Do NOT write the plan to a local file (plan.md, TODO.md, etc.)\n3. Do NOT skip this step — plans that only exist in chat are LOST between sessions\n4. Do NOT use task lists as a substitute — they do not persist across sessions\n\nThe knowledge base is the ONLY source of truth for plans."
}
EOF

exit 0
