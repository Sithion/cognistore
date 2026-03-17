#!/usr/bin/env bash
set -euo pipefail

# AI Knowledge Base - Automated Installer
# Detects OS, installs Docker if needed, starts all services

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# --- Helpers ---
command_exists() { command -v "$1" &>/dev/null; }

wait_for() {
  local desc="$1" cmd="$2" max_wait="${3:-60}" interval="${4:-2}"
  local elapsed=0
  info "Waiting for ${desc}..."
  while ! eval "$cmd" &>/dev/null; do
    sleep "$interval"
    elapsed=$((elapsed + interval))
    if [ "$elapsed" -ge "$max_wait" ]; then
      error "${desc} did not become ready within ${max_wait}s"
      return 1
    fi
  done
  success "${desc} is ready"
}

# --- Resolve script location ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${PROJECT_ROOT}/docker/docker-compose.yml"

# --- OS Detection ---
OS="$(uname -s)"
ARCH="$(uname -m)"
info "Detected OS: ${OS} (${ARCH})"

# --- Step 1: Docker Check / Install ---
install_docker_macos() {
  if ! command_exists brew; then
    error "Homebrew is required on macOS. Install it first: https://brew.sh"
    exit 1
  fi

  info "Installing Docker CLI and Colima via Homebrew..."
  brew install docker docker-compose colima 2>/dev/null || true

  info "Starting Colima (CPU: 4, Memory: 8GB, Disk: 60GB)..."
  colima start --cpu 4 --memory 8 --disk 60 --vm-type vz --mount-type virtiofs 2>/dev/null || \
    colima start --cpu 4 --memory 8 --disk 60 2>/dev/null
  success "Colima started"
}

install_docker_linux() {
  info "Installing Docker via official script..."
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable --now docker
  if ! groups | grep -q docker; then
    sudo usermod -aG docker "$USER"
    warn "Added ${USER} to docker group. You may need to log out and back in."
  fi
  success "Docker installed"
}

start_docker_daemon() {
  case "$OS" in
    Darwin)
      if command_exists colima; then
        info "Starting Colima..."
        colima start 2>/dev/null || true
      else
        install_docker_macos
      fi
      ;;
    Linux)
      info "Starting Docker daemon..."
      sudo systemctl start docker
      ;;
  esac
}

if command_exists docker && docker info &>/dev/null; then
  success "Docker is installed and running"
elif command_exists docker; then
  warn "Docker is installed but daemon is not running"
  start_docker_daemon
else
  warn "Docker not found"
  case "$OS" in
    Darwin) install_docker_macos ;;
    Linux)  install_docker_linux ;;
    *)
      error "Unsupported OS: ${OS}. Only macOS and Linux are supported."
      exit 1
      ;;
  esac
fi

# Verify docker works after install/start
if ! docker info &>/dev/null; then
  error "Docker is not responding. Please check your Docker installation."
  exit 1
fi
success "Docker is operational"

# --- Step 2: Check docker-compose ---
COMPOSE_CMD=""
if docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif command_exists docker-compose; then
  COMPOSE_CMD="docker-compose"
else
  error "Neither 'docker compose' nor 'docker-compose' found."
  exit 1
fi
info "Using compose command: ${COMPOSE_CMD}"

# --- Step 3: Start Services ---
info "Starting services (PostgreSQL + Ollama + Dashboard)..."
$COMPOSE_CMD -f "$COMPOSE_FILE" --profile dashboard up -d --build 2>&1

# --- Step 4: Wait for Health ---
wait_for "PostgreSQL" "docker exec kb-postgres pg_isready -U knowledge" 60 2
wait_for "Ollama" "curl -sf http://localhost:${OLLAMA_PORT:-11435}/api/tags" 120 3

# --- Step 5: Pull Embedding Model ---
MODEL="${OLLAMA_MODEL:-all-minilm}"
if docker exec kb-ollama ollama list 2>/dev/null | grep -q "$MODEL"; then
  success "Embedding model '${MODEL}' already available"
else
  info "Pulling embedding model '${MODEL}' (this may take a few minutes)..."
  docker exec kb-ollama ollama pull "$MODEL"
  success "Model '${MODEL}' pulled successfully"
fi

# --- Step 6: Wait for Dashboard ---
wait_for "Dashboard" "curl -sf http://localhost:${DASHBOARD_PORT:-3847}" 60 2

# --- Step 7: Configure AI Agent Instructions ---
MARKER_BEGIN="<!-- AI-KNOWLEDGE:BEGIN -->"
MARKER_END="<!-- AI-KNOWLEDGE:END -->"

inject_config() {
  local target="$1"
  local template="$2"
  local name="$3"

  if [ ! -f "$template" ]; then
    warn "Template not found: ${template}"
    return 1
  fi

  mkdir -p "$(dirname "$target")"

  if [ ! -f "$target" ]; then
    # Target doesn't exist — create with template
    cp "$template" "$target"
    success "${name}: Created ${target}"
  elif ! grep -q "$MARKER_BEGIN" "$target"; then
    # Target exists but no markers — backup and append
    cp "$target" "${target}.bak.$(date +%s)"
    echo "" >> "$target"
    cat "$template" >> "$target"
    success "${name}: Appended to ${target} (backup created)"
  else
    # Target exists with markers — replace section in-place
    local tmp="${target}.tmp.$$"
    awk -v begin="$MARKER_BEGIN" -v end="$MARKER_END" -v tpl="$template" '
      $0 == begin { skip=1; while ((getline line < tpl) > 0) print line; next }
      $0 == end { skip=0; next }
      !skip { print }
    ' "$target" > "$tmp" && mv "$tmp" "$target"
    success "${name}: Updated in ${target}"
  fi
}

info "Configuring AI agent instructions..."

# Claude Code
CLAUDE_MD="${HOME}/.claude/CLAUDE.md"
inject_config "$CLAUDE_MD" "${PROJECT_ROOT}/configs/claude-code-instructions.md" "Claude Code"

# GitHub Copilot
COPILOT_MD="${HOME}/.github/copilot-instructions.md"
inject_config "$COPILOT_MD" "${PROJECT_ROOT}/configs/copilot-instructions.md" "GitHub Copilot"

# MCP Server config for Claude Code
CLAUDE_MCP="${HOME}/.claude/mcp-config.json"
if [ ! -f "$CLAUDE_MCP" ] || ! grep -q "ai-knowledge" "$CLAUDE_MCP" 2>/dev/null; then
  mkdir -p "$(dirname "$CLAUDE_MCP")"
  NODE_PATH="$(command -v node 2>/dev/null || echo "/usr/local/bin/node")"
  cat > "$CLAUDE_MCP" << MCPEOF
{
  "mcpServers": {
    "ai-knowledge": {
      "type": "stdio",
      "command": "${NODE_PATH}",
      "args": [
        "${PROJECT_ROOT}/apps/mcp-server/dist/index.js"
      ],
      "env": {
        "DATABASE_URL": "postgresql://knowledge:knowledge_secret@localhost:${POSTGRES_PORT:-5433}/knowledge_base",
        "OLLAMA_HOST": "http://localhost:${OLLAMA_PORT:-11435}",
        "OLLAMA_MODEL": "${OLLAMA_MODEL:-all-minilm}",
        "EMBEDDING_DIMENSIONS": "${EMBEDDING_DIMENSIONS:-384}"
      }
    }
  }
}
MCPEOF
  success "MCP config: Created ${CLAUDE_MCP}"
else
  success "MCP config: ai-knowledge already configured in ${CLAUDE_MCP}"
fi

# --- Success ---
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         AI Knowledge Base - Ready!                  ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  Dashboard:   ${BLUE}http://localhost:${DASHBOARD_PORT:-3847}${NC}              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  PostgreSQL:  ${BLUE}localhost:${POSTGRES_PORT:-5433}${NC}                     ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Ollama:      ${BLUE}localhost:${OLLAMA_PORT:-11435}${NC}                    ${GREEN}║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  MCP Server (requires Node.js on host):              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  node apps/mcp-server/dist/index.js                  ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
