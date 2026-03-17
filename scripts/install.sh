#!/usr/bin/env bash
set -euo pipefail

# AI Knowledge Base - Bootstrap Installer
# Ensures Node.js and pnpm are available, builds the project,
# then runs the interactive TypeScript installer wizard.

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

# --- Resolve script location ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# --- Step 1: Check Node.js ---
NODE_CMD=""
MIN_NODE_VERSION=20

check_node_version() {
  local node_path="$1"
  local version
  version=$("$node_path" --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
  [ "${version:-0}" -ge "$MIN_NODE_VERSION" ]
}

if command -v node &>/dev/null && check_node_version "node"; then
  NODE_CMD="node"
  success "Node.js $(node --version) found"
elif [ -f "$HOME/.nvm/nvm.sh" ]; then
  info "Loading nvm..."
  export NVM_DIR="$HOME/.nvm"
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  if command -v node &>/dev/null && check_node_version "node"; then
    NODE_CMD="node"
    success "Node.js $(node --version) found via nvm"
  else
    info "Installing Node.js $MIN_NODE_VERSION via nvm..."
    nvm install "$MIN_NODE_VERSION"
    nvm use "$MIN_NODE_VERSION"
    NODE_CMD="node"
  fi
else
  error "Node.js >= $MIN_NODE_VERSION is required but not found."
  echo ""
  info "Install Node.js using one of these methods:"
  echo "  1. nvm (recommended): curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash"
  echo "  2. Direct download: https://nodejs.org/"
  echo "  3. macOS: brew install node"
  echo "  4. Linux: curl -fsSL https://deb.nodesource.com/setup_${MIN_NODE_VERSION}.x | sudo -E bash - && sudo apt-get install -y nodejs"
  echo ""
  info "After installing Node.js, run this script again."

  # Offer legacy fallback
  if [ -f "${SCRIPT_DIR}/install-legacy.sh" ]; then
    echo ""
    warn "Alternatively, you can use the legacy bash installer:"
    echo "  bash ${SCRIPT_DIR}/install-legacy.sh"
  fi
  exit 1
fi

# --- Step 2: Check pnpm ---
if ! command -v pnpm &>/dev/null; then
  info "pnpm not found. Installing..."
  if command -v corepack &>/dev/null; then
    corepack enable pnpm 2>/dev/null || npm install -g pnpm
  else
    npm install -g pnpm
  fi
  success "pnpm installed"
else
  success "pnpm $(pnpm --version) found"
fi

# --- Step 3: Install dependencies ---
info "Installing project dependencies..."
cd "$PROJECT_ROOT"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
success "Dependencies installed"

# --- Step 4: Build project ---
info "Building project..."
pnpm build
success "Project built"

# --- Step 5: Run interactive installer ---
info "Starting interactive installer..."
echo ""
"$NODE_CMD" "${PROJECT_ROOT}/apps/cli/dist/index.js" install
