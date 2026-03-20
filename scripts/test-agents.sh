#!/usr/bin/env bash
# ============================================================================
# CogniStore Agent Test Battery (Local Development)
#
# Replicates .dmg setup locally, runs tests, checks DB, then cleans everything.
# Uses Docker Ollama on port 11435 + ~/.cognistore-local/ to avoid prod conflict.
# ============================================================================

set -euo pipefail

PROJECT_ROOT="/Users/RXT07/Projects/knowledge-base"
SANDBOX="/Users/RXT07/Projects/agents-test"
LOCAL_DIR="$HOME/.cognistore-local"
DB_PATH="$LOCAL_DIR/knowledge.db"
MCP_DIST="$PROJECT_ROOT/apps/mcp-server/dist/index.js"
TEMPLATES="$PROJECT_ROOT/apps/dashboard/templates"
RESULTS_DIR="/tmp/cognistore-test-results"
BACKUP_DIR="/tmp/cognistore-test-backup-$$"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OLLAMA_PORT=11435
OLLAMA_CONTAINER="cognistore-test-ollama"
OLLAMA_URL="http://localhost:$OLLAMA_PORT"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

mkdir -p "$RESULTS_DIR" "$SANDBOX" "$LOCAL_DIR" "$BACKUP_DIR"

# ── Cleanup on exit ──────────────────────────────────────────────────────────

cleanup() {
  echo ""
  echo -e "${CYAN}Restoring...${NC}"
  for f in claude-mcp-config.json copilot-mcp-config.json opencode.json claude-settings.json; do
    [ ! -f "$BACKUP_DIR/$f" ] && continue
    case "$f" in
      claude-mcp-config.json)  cp "$BACKUP_DIR/$f" "$HOME/.claude/mcp-config.json" ;;
      copilot-mcp-config.json) cp "$BACKUP_DIR/$f" "$HOME/.copilot/mcp-config.json" ;;
      opencode.json)           cp "$BACKUP_DIR/$f" "$HOME/.config/opencode/opencode.json" ;;
      claude-settings.json)    cp "$BACKUP_DIR/$f" "$HOME/.claude/settings.json" ;;
    esac
  done
  for td in claude copilot; do
    for skill in cognistore-query cognistore-capture cognistore-plan; do
      rm -rf "$HOME/.$td/skills/$skill"
      [ -d "$BACKUP_DIR/$td-skills/$skill" ] && cp -r "$BACKUP_DIR/$td-skills/$skill" "$HOME/.$td/skills/$skill"
    done
  done
  docker rm -f "$OLLAMA_CONTAINER" 2>/dev/null || true
  rm -rf "$LOCAL_DIR" "$BACKUP_DIR"
  # Clean sandbox
  rm -f "$SANDBOX"/research-*.md 2>/dev/null || true
  echo -e "  ${GREEN}✓ Production restored, local env removed${NC}"
}
trap cleanup EXIT

# ── Test prompt ──────────────────────────────────────────────────────────────

PROMPT='You MUST follow the CogniStore workflow protocol for this task.

## Task: Markdown File Research & Documentation
Working directory: /Users/RXT07/Projects/agents-test/

### Step 1: Research existing patterns
Search the knowledge base: getKnowledge(query: "markdown file creation workflow"). Note any result IDs — link them to your plan as INPUT relations.

### Step 2: Create 3 markdown files in /Users/RXT07/Projects/agents-test/:
- `research-alpha.md` — "# Alpha Research" + Lorem ipsum paragraph
- `research-beta.md` — "# Beta Research" + Lorem ipsum paragraph
- `research-gamma.md` — "# Gamma Research" + Lorem ipsum paragraph

### Step 3: Verify files
Glob to confirm 3 .md files exist. Grep to verify "Lorem" in each.

### Step 4: Document discovery
addKnowledge: title "research-*.md naming convention", type: pattern, scope: workspace:agents-test, tags: ["markdown","naming-convention","test"]. Then addPlanRelation(planId, newKnowledgeId, "output").

### Step 5: Clean up
Delete research-*.md files. Glob to confirm empty.

MANDATORY — you will be scored on these:
- FIRST: getKnowledge() before anything else
- createPlan() with tasks array for each step
- updatePlan(status: "active") BEFORE first task — DO NOT SKIP
- updatePlanTask(in_progress) BEFORE each task, updatePlanTask(completed) AFTER
- After Step 1: if getKnowledge returned ANY results, call addPlanRelation(planId, resultEntryId, "input") for EACH result. This is CRITICAL — do not skip input relations.
- After Step 4: call addPlanRelation(planId, newKnowledgeId, "output") for the entry you created
- NEVER link system knowledge (type=system) to plans
- updatePlan(status: "completed") after ALL tasks done
- All entries in English'

# ── Helpers ──────────────────────────────────────────────────────────────────

get_latest_plan() {
  sqlite3 "$DB_PATH" "SELECT id FROM plans ORDER BY created_at DESC LIMIT 1" 2>/dev/null || echo ""
}

check_test() {
  local label="$1" before="${2:-}"

  if [ ! -f "$DB_PATH" ]; then
    echo -e "  ${RED}[$label] DB not found${NC}"; return
  fi

  local pid=$(sqlite3 "$DB_PATH" "SELECT id FROM plans ORDER BY created_at DESC LIMIT 1" 2>/dev/null || echo "")
  local ptitle=$(sqlite3 "$DB_PATH" "SELECT title FROM plans WHERE id='$pid'" 2>/dev/null || echo "")
  local pstatus=$(sqlite3 "$DB_PATH" "SELECT status FROM plans WHERE id='$pid'" 2>/dev/null || echo "")

  if [ -z "$pid" ] || { [ -n "$before" ] && [ "$pid" = "$before" ]; }; then
    echo -e "  ${RED}✗ [$label] No new plan (0/5)${NC}"; return
  fi

  local score=0 details=""

  [ "$pstatus" = "completed" ] && score=$((score+1)) && details+="status:✓ " || details+="status:$pstatus "

  local tc=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM plan_tasks WHERE plan_id='$pid'" 2>/dev/null || echo 0)
  local cc=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM plan_tasks WHERE plan_id='$pid' AND status='completed'" 2>/dev/null || echo 0)
  [ "$cc" = "$tc" ] && [ "$tc" != "0" ] && score=$((score+1)) && details+="tasks:$cc/$tc✓ " || details+="tasks:$cc/$tc "

  local ir=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM plan_relations WHERE plan_id='$pid' AND relation_type='input'" 2>/dev/null || echo 0)
  local or_=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM plan_relations WHERE plan_id='$pid' AND relation_type='output'" 2>/dev/null || echo 0)
  [ "$ir" -gt 0 ] && score=$((score+1)) && details+="in:${ir}✓ " || details+="in:0 "
  [ "$or_" -gt 0 ] && score=$((score+1)) && details+="out:${or_}✓ " || details+="out:0 "

  local kn=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM knowledge_entries WHERE type!='system'" 2>/dev/null || echo 0)
  [ "$kn" -gt 0 ] && score=$((score+1)) && details+="kb:${kn}✓" || details+="kb:0"

  local color="$RED"; [ "$score" -ge 3 ] && color="$YELLOW"; [ "$score" -ge 5 ] && color="$GREEN"
  echo -e "  ${color}[$label] ${score}/5${NC}  $ptitle — $details"
}

run_test() {
  local tool="$1" mode="$2"
  local out="$RESULTS_DIR/${tool}_${mode}_${TIMESTAMP}.log"

  echo -n "  $tool ($mode)... "
  rm -f "$SANDBOX"/research-*.md 2>/dev/null || true

  local before=$(get_latest_plan)
  local t0=$(date +%s) rc=0

  # MCP config for Claude (inline JSON to guarantee local MCP is used)
  local MCP_JSON='{"mcpServers":{"cognistore":{"type":"stdio","command":"node","args":["'"$MCP_DIST"'"],"env":{"SQLITE_PATH":"'"$DB_PATH"'","OLLAMA_HOST":"'"$OLLAMA_URL"'","OLLAMA_MODEL":"all-minilm","EMBEDDING_DIMENSIONS":"384"}}}}'

  case "$tool" in
    claude)
      if [ "$mode" = "plan" ]; then
        # Two-session plan mode:
        # Session 1: Plan only
        local plan_out="$RESULTS_DIR/${tool}_${mode}_s1_${TIMESTAMP}.log"
        (cd "$SANDBOX" && claude -p "$PROMPT" \
          --permission-mode plan \
          --add-dir "$SANDBOX" \
          --output-format text \
          --max-turns 80 \
          --mcp-config "$MCP_JSON" \
          --strict-mcp-config \
          --dangerously-skip-permissions \
          > "$plan_out" 2>&1) || true

        # Session 2: Execute (continue most recent session)
        (cd "$SANDBOX" && claude -p "The plan is approved. Execute it now. Follow all MANDATORY requirements from the original prompt." \
          --output-format text \
          --max-turns 80 \
          --mcp-config "$MCP_JSON" \
          --strict-mcp-config \
          --dangerously-skip-permissions \
          --continue \
          > "$out" 2>&1) || rc=$?
      else
        claude -p "$PROMPT" \
          --add-dir "$SANDBOX" \
          --output-format text \
          --max-turns 80 \
          --mcp-config "$MCP_JSON" \
          --strict-mcp-config \
          --dangerously-skip-permissions \
          > "$out" 2>&1 || rc=$?
      fi
      ;;
    copilot)
      if [ "$mode" = "plan" ]; then
        # Simulated plan mode: session 1 plan only, session 2 execute
        local plan_out="$RESULTS_DIR/${tool}_${mode}_s1_${TIMESTAMP}.log"
        (cd "$SANDBOX" && copilot -p "ONLY PLAN, do NOT execute any tools yet. Create a createPlan() with tasks but do NOT start execution. $PROMPT" \
          --allow-all > "$plan_out" 2>&1) || true
        (cd "$SANDBOX" && copilot -p "The plan is approved. Execute it now. Follow all MANDATORY requirements." \
          --allow-all --continue > "$out" 2>&1) || rc=$?
      else
        copilot -p "$PROMPT" --allow-all > "$out" 2>&1 || rc=$?
      fi
      ;;
    opencode)
      local agent_flag=""
      [ "$mode" = "plan" ] && agent_flag="--agent plan"
      (cd "$SANDBOX" && opencode run $agent_flag "$PROMPT") > "$out" 2>&1 || rc=$?
      ;;
  esac

  local dur=$(( $(date +%s) - t0 ))
  [ $rc -eq 0 ] && echo -e "${GREEN}${dur}s${NC}" || echo -e "${RED}fail(${rc}) ${dur}s${NC}"

  check_test "$tool/$mode" "$before"
  rm -f "$SANDBOX"/research-*.md 2>/dev/null || true
}

# ══════════════════════════════════════════════════════════════════════════════
echo -e "${CYAN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  CogniStore Test Battery — $TIMESTAMP ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"

# ── Phase 1: Build ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Phase 1: Build${NC}"
cd "$PROJECT_ROOT"
for pkg in shared core embeddings sdk; do
  (cd "packages/$pkg" && npx tsc) && echo -e "  ${GREEN}✓${NC} $pkg"
done
(cd apps/mcp-server && npm run build 2>&1 | tail -1) && echo -e "  ${GREEN}✓${NC} mcp-server"
(cd apps/dashboard && npm run build 2>&1 | tail -1) && echo -e "  ${GREEN}✓${NC} dashboard"

# ── Phase 2: Setup ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Phase 2: Setup${NC}"

# Ollama Docker
echo -n "  Ollama... "
docker rm -f "$OLLAMA_CONTAINER" 2>/dev/null || true
docker run -d --name "$OLLAMA_CONTAINER" -p "$OLLAMA_PORT:11434" ollama/ollama:latest > /dev/null 2>&1
for i in $(seq 1 30); do curl -sf "$OLLAMA_URL/api/tags" > /dev/null 2>&1 && break; sleep 1; done
curl -sf "$OLLAMA_URL/api/tags" > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}" || { echo -e "${RED}✗${NC}"; exit 1; }
echo -n "  Model... "
docker exec "$OLLAMA_CONTAINER" ollama pull all-minilm > /dev/null 2>&1 && echo -e "${GREEN}✓${NC}"

# DB via SQL
echo -n "  DB... "
sqlite3 "$DB_PATH" < "$PROJECT_ROOT/packages/core/src/db/migrations/0.8.0.sql"
sqlite3 "$DB_PATH" < "$PROJECT_ROOT/packages/core/src/db/migrations/0.9.0.sql" 2>/dev/null || true
sqlite3 "$DB_PATH" "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at INTEGER)"
sqlite3 "$DB_PATH" "INSERT OR IGNORE INTO __drizzle_migrations VALUES (1,'0.8.0',strftime('%s','now')),(2,'0.9.0',strftime('%s','now'))"
echo -e "${GREEN}✓${NC}"

# System knowledge
echo -n "  System KB... "
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SYSKB_ID=$(uuidgen)
sqlite3 "$DB_PATH" <<EOSQL
INSERT INTO knowledge_entries (id,title,content,tags,type,scope,source,version,confidence_score,created_at,updated_at) VALUES (
'$SYSKB_ID','CogniStore Agent Workflow',
'## MANDATORY PROTOCOL
### Step 1: Query First - getKnowledge() BEFORE anything
### Step 2: Plan Lifecycle - createPlan(), updatePlan(active) BEFORE first task, track tasks, updatePlan(completed) after all done. NEVER set archived.
### Step 2b: Link Knowledge - addPlanRelation(input) for consulted, addPlanRelation(output) for created
### Step 3: Capture Knowledge - addKnowledge() before ending. Update existing instead of duplicating.
### Rules: English only. Never skip getKnowledge(). createPlan() is source of truth.',
'["system","workflow"]','system','global','test-setup',1,1.0,'$NOW','$NOW');
EOSQL
echo -e "${GREEN}✓${NC}"

# Backup prod
echo -n "  Backup... "
[ -f "$HOME/.claude/mcp-config.json" ] && cp "$HOME/.claude/mcp-config.json" "$BACKUP_DIR/claude-mcp-config.json"
[ -f "$HOME/.copilot/mcp-config.json" ] && cp "$HOME/.copilot/mcp-config.json" "$BACKUP_DIR/copilot-mcp-config.json"
[ -f "$HOME/.config/opencode/opencode.json" ] && cp "$HOME/.config/opencode/opencode.json" "$BACKUP_DIR/opencode.json"
[ -f "$HOME/.claude/settings.json" ] && cp "$HOME/.claude/settings.json" "$BACKUP_DIR/claude-settings.json"
mkdir -p "$BACKUP_DIR/claude-skills" "$BACKUP_DIR/copilot-skills"
for s in cognistore-query cognistore-capture cognistore-plan; do
  [ -d "$HOME/.claude/skills/$s" ] && cp -r "$HOME/.claude/skills/$s" "$BACKUP_DIR/claude-skills/$s"
  [ -d "$HOME/.copilot/skills/$s" ] && cp -r "$HOME/.copilot/skills/$s" "$BACKUP_DIR/copilot-skills/$s"
done
echo -e "${GREEN}✓${NC}"

# Swap MCP configs
echo -n "  MCP swap... "
python3 -c "
import json, os
mcp = {'type':'stdio','command':'node','args':['$MCP_DIST'],'env':{'SQLITE_PATH':'$DB_PATH','OLLAMA_HOST':'$OLLAMA_URL','OLLAMA_MODEL':'all-minilm','EMBEDDING_DIMENSIONS':'384'}}
for p in ['$HOME/.claude/mcp-config.json','$HOME/.copilot/mcp-config.json']:
    if os.path.exists(p):
        with open(p) as f: d=json.load(f)
        d['mcpServers']['cognistore']=mcp
        with open(p,'w') as f: json.dump(d,f,indent=2)
oc='$HOME/.config/opencode/opencode.json'
if os.path.exists(oc):
    with open(oc) as f: d=json.load(f)
    d.setdefault('mcp',{})['cognistore']={'type':'local','command':['node','$MCP_DIST'],'enabled':True,'environment':{'SQLITE_PATH':'$DB_PATH','OLLAMA_HOST':'$OLLAMA_URL','OLLAMA_MODEL':'all-minilm','EMBEDDING_DIMENSIONS':'384'}}
    with open(oc,'w') as f: json.dump(d,f,indent=2)
"
echo -e "${GREEN}✓${NC}"

# Deploy local skills
echo -n "  Skills... "
for skill in cognistore-query cognistore-capture cognistore-plan; do
  for tt in claude-code copilot; do
    src="$TEMPLATES/skills/$tt/$skill"
    [ ! -d "$src" ] && continue
    dd=$([ "$tt" = "claude-code" ] && echo ".claude" || echo ".copilot")
    dest="$HOME/$dd/skills/$skill"
    rm -rf "$dest"; mkdir -p "$dest"; cp -r "$src"/* "$dest"/
    find "$dest/hooks" -name "*.sh" -exec chmod 755 {} \; 2>/dev/null || true
  done
done
echo -e "${GREEN}✓${NC}"

# ── Phase 3: Tests ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Phase 3: Tests${NC}"

run_test "claude" "normal"
run_test "claude" "plan"
run_test "copilot" "normal"
run_test "copilot" "plan"
run_test "opencode" "normal"
run_test "opencode" "plan"

# ── Results ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}═══ SUMMARY ═══${NC}"
if [ -f "$DB_PATH" ]; then
  echo "  Plans:     $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM plans') ($(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM plans WHERE status='completed'") completed)"
  echo "  Tasks:     $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM plan_tasks') ($(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM plan_tasks WHERE status='completed'") completed)"
  echo "  Knowledge: $(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM knowledge_entries WHERE type!='system'") entries"
  echo "  Relations: $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM plan_relations') links"
fi
echo "  Logs: $RESULTS_DIR/*_${TIMESTAMP}.log"
echo ""
echo -e "${GREEN}Cleaning up...${NC}"
