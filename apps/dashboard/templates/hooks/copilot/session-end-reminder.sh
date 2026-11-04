#!/usr/bin/env bash
# sessionEnd: remind to capture knowledge before the session ends. Reminder-only.
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
cleanup() { rm -f "${COG_MARK}-queried" "$CAPTURED"; }

if [ -f "$CAPTURED" ]; then
  cleanup
  printf '{"systemMessage":"[CogniStore] Session ending — knowledge captured. Mark remaining plan tasks completed. Discovered a reusable PATTERN about a language/framework/tool? Store it with type: \\"pattern\\", scope: \\"global\\".%s"}\n' "$HINT"
else
  cleanup
  printf '{"systemMessage":"[CogniStore] Session ending — you have NOT captured knowledge. If you learned, fixed, decided, or discovered anything reusable, call cognistore-addKnowledge({ title, content, tags, type, scope, source, planId }) NOW. Reusable insights → type: \\"pattern\\", scope: \\"global\\". All CogniStore tools are pre-approved.%s"}\n' "$HINT"
fi
exit 0
