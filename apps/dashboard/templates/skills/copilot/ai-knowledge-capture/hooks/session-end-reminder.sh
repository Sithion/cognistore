#!/usr/bin/env bash
# SessionEnd hook: Reminds the agent to capture knowledge after completing work.
# Non-blocking — only adds a systemMessage.

set -euo pipefail

cat <<'EOF'
{
  "systemMessage": "[AI Knowledge] MANDATORY: Before finishing this session, capture any high-value knowledge you discovered.\n\nOnly store insights that save future sessions significant time (not trivial fixes or standard docs).\n\nAsk yourself:\n- Did I fix a non-obvious bug? → type: 'fix' (include root cause + prevention)\n- Did I make a technical decision? → type: 'decision' (include reasoning + alternatives)\n- Did I find a reusable pattern? → type: 'pattern' (include where/how to reuse)\n- Did I hit a limitation? → type: 'constraint' (include workaround)\n- Did I encounter unexpected behavior? → type: 'gotcha' (include symptoms + fix)\n\nIf a related entry already exists from your initial query, UPDATE it (updateKnowledge) instead of creating a duplicate.\nAll entries MUST be in English."
}
EOF

exit 0
