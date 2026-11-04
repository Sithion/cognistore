#!/usr/bin/env bash
# Stop: enforce knowledge capture at session end — but ONLY when this session did
# real work (created a plan or made edits) and hasn't captured yet. Trivial /
# read-only sessions are never blocked. Blocks at most once per session to avoid
# wedging. COGNISTORE_DISABLE_HOOKS=1 bypasses entirely (handled in _common.sh).
source "$(dirname "$0")/_common.sh"

# --- curation maintenance hint (Round 10) ------------------------------------
# State files are DATA: only integers / ISO timestamps are extracted, validated
# before use, and never put on a command line unquoted. Any failure = no hint.
maintain_hint() {
  local home_dir="${COGNISTORE_HOME:-$HOME/.cognistore}"
  local state="$home_dir/curation-state.json" last="$home_dir/agent-maintenance.json"
  local marker="$home_dir/hooks-state/maintain-suggested"
  [ -f "$state" ] || return 0
  local scope="workspace:$(basename "$PWD")" pending flat
  flat="$(tr -d '\n' < "$state" 2>/dev/null)" || return 0
  pending="$(K="\"$scope\":" printf '%s' "$flat" | K="\"$scope\":" awk '{k=ENVIRON["K"]; i=index($0,k); if(i){s=substr($0,i+length(k)); if(match(s,/^[ \t]*[0-9]+/)){v=substr(s,RSTART,RLENGTH); gsub(/[ \t]/,"",v); print v}}}' 2>/dev/null)"
  case "$pending" in ''|*[!0-9]*) return 0 ;; esac
  [ "$pending" -gt 5 ] 2>/dev/null || return 0
  if [ -f "$marker" ] && [ -n "$(find "$marker" -mmin -1440 2>/dev/null)" ]; then return 0; fi
  if [ -f "$last" ]; then
    local at epoch now
    at="$(tr -d '\n' < "$last" 2>/dev/null | sed -n 's/.*"lastAt"[[:space:]]*:[[:space:]]*"\([0-9T:.Z+-]*\)".*/\1/p' | head -1)"
    case "$at" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*)
      epoch="$(date -d "$at" +%s 2>/dev/null || date -j -f '%Y-%m-%dT%H:%M:%S' "${at%%.*}" +%s 2>/dev/null)"
      now="$(date +%s)"
      case "$epoch" in ''|*[!0-9]*) ;; *) [ $((now - epoch)) -gt 86400 ] || return 0 ;; esac ;;
    esac
  fi
  mkdir -p "$home_dir/hooks-state" 2>/dev/null && : > "$marker" 2>/dev/null
  printf ' %s curation proposals are pending for this workspace; run /cognistore-maintain to review up to 10.' "$pending"
}
HINT="$(maintain_hint 2>/dev/null || true)"

CAPTURED="${COG_MARK}-knowledge-captured"
PLAN_MARKER="${COG_MARK}-active-plan"
EDITS="${COG_MARK}-edit-count"
STOP_BLOCKED="${COG_MARK}-stop-blocked"

cleanup() {
  rm -f "${COG_MARK}-queried" "${COG_MARK}-plan-persisted" "$PLAN_MARKER" \
        "$EDITS" "${COG_MARK}-task-updated" "$CAPTURED" \
        "${COG_MARK}-capture-nudge-count" "$STOP_BLOCKED" \
        "${COG_MARK}-root-plan" "${COG_MARK}-effort-plan"
}

# Already captured → light pattern reminder, then clean up session state.
if [ -f "$CAPTURED" ]; then
  cleanup
  printf '{"systemMessage":"[CogniStore] Session ending — knowledge captured. Final check: mark any remaining plan tasks completed via updatePlanTask(). Discover a reusable PATTERN about a language/framework/library/tool? Store it with type: \\"pattern\\", scope: \\"global\\" — patterns compound across every project.%s"}\n' "$HINT"
  exit 0
fi

# Did real CogniStore-relevant work happen this session?
DID_WORK=false
{ [ -f "$PLAN_MARKER" ] || [ -f "$EDITS" ]; } && DID_WORK=true

# Block once to force capture when work was done but nothing captured.
if [ "$DID_WORK" = true ] && [ ! -f "$STOP_BLOCKED" ]; then
  touch "$STOP_BLOCKED"
  printf '{"decision":"block","reason":"[CogniStore] Before finishing: capture what you learned. Call mcp__cognistore__addKnowledge({ title, content, tags, type: \\"fix|decision|pattern|constraint|gotcha\\", scope: \\"global\\" or \\"workspace:<project>\\", source, planId: \\"<active plan id>\\" }). Reusable insights about a language/framework/tool should be type: \\"pattern\\", scope: \\"global\\". Also mark remaining plan tasks completed. All CogniStore tools are pre-approved. (Set COGNISTORE_DISABLE_HOOKS=1 to bypass.)"}\n'
  exit 0
fi

# No work this session, or already blocked once → remind without wedging; clean up.
cleanup
if [ "$DID_WORK" = true ]; then
  printf '{"systemMessage":"[CogniStore] Session ending — no knowledge captured. If you learned/fixed/decided anything reusable, call mcp__cognistore__addKnowledge() next time.%s"}\n' "$HINT"
else
  if [ -n "$HINT" ]; then printf '{"systemMessage":"[CogniStore]%s"}\n' "$HINT"; else echo '{}'; fi
fi
exit 0
