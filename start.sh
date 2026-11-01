
#!/usr/bin/env bash

# ============================================================
# DiMaT - Development Startup Script
# Starts the frontend and backend concurrently.
# ============================================================

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Configuration
WEB_URL="http://localhost:5173"
SERVER_URL="http://localhost:3000"

SERVER_PID=""
WEB_PID=""

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

log() {
    echo -e "${CYAN}[DiMaT]${RESET} $1"
}

success() {
    echo -e "${GREEN}[OK]${RESET} $1"
}

error() {
    echo -e "${RED}[ERROR]${RESET} $1" >&2
}

cleanup() {
    echo
    log "Shutting down DiMaT..."

    [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
    [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true

    wait 2>/dev/null || true

    success "All services stopped."
}

trap cleanup EXIT INT TERM

clear

echo -e "${CYAN}"
echo "  ____  _ __  __    _   _____"
echo " |  _ \\(_)  \\/  |  / \\ |_   _|"
echo " | | | | | |\\/| | / _ \\  | |"
echo " | |_| | | |  | |/ ___ \\ | |"
echo " |____/|_|_|  |_/_/   \\_\\|_|"
echo -e "${RESET}"
echo "        DiMaT Development Environment"
echo "================================================"
echo

# 1. Verify prerequisites
log "Checking prerequisites..."

for cmd in node pnpm; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        error "$cmd is not installed."
        exit 1
    fi
done

success "Node.js $(node --version)"
success "pnpm $(pnpm --version)"

# 2. Verify project structure
if [[ ! -f package.json || ! -f pnpm-workspace.yaml ]]; then
    error "DiMaT workspace files not found."
    exit 1
fi

# 3. Install dependencies if needed
if [[ ! -d node_modules ]]; then
    log "Installing workspace dependencies..."
    pnpm install
else
    success "Dependencies already installed."
fi

# 4. Start backend
log "Starting backend..."

pnpm --filter @dimat/server dev &
SERVER_PID=$!

# 5. Start frontend
log "Starting frontend..."

pnpm --filter @dimat/web dev &
WEB_PID=$!

echo
echo "================================================"
success "DiMaT development environment started!"
echo
echo -e "  Frontend: ${GREEN}${WEB_URL}${RESET}"
echo -e "  Backend:  ${GREEN}${SERVER_URL}${RESET}"
echo
echo "  Frontend and backend are running concurrently."
echo "  Press Ctrl+C to stop both services."
echo "================================================"
echo

# 6. Monitor both services
while true; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        error "Backend process stopped unexpectedly."
        exit 1
    fi

    if ! kill -0 "$WEB_PID" 2>/dev/null; then
        error "Frontend process stopped unexpectedly."
        exit 1
    fi

    sleep 2
done
