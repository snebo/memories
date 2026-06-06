#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# setup.sh — one-shot developer environment bootstrap
#
# Usage:
#   bash scripts/setup.sh           # full setup
#   bash scripts/setup.sh --no-db   # skip migration (services already seeded)
# ---------------------------------------------------------------------------
set -euo pipefail

NO_DB=false
for arg in "$@"; do
  [[ "$arg" == "--no-db" ]] && NO_DB=true
done

BLUE="\033[1;34m"; GREEN="\033[1;32m"; RED="\033[1;31m"; RESET="\033[0m"

log()  { echo -e "${BLUE}[setup]${RESET} $*"; }
ok()   { echo -e "${GREEN}[ok]${RESET}    $*"; }
fail() { echo -e "${RED}[fail]${RESET}  $*"; exit 1; }

# ---------------------------------------------------------------------------
# 1. Ensure .env exists
# ---------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  log "Copying .env.example → .env"
  cp .env.example .env
  ok ".env created — update OPENAI_API_KEY before starting the app"
else
  ok ".env already present"
fi

# ---------------------------------------------------------------------------
# 2. Install Node dependencies
# ---------------------------------------------------------------------------
log "Installing npm dependencies..."
npm install --silent
ok "npm install complete"

# ---------------------------------------------------------------------------
# 3. Start Docker services
# ---------------------------------------------------------------------------
log "Starting Docker Compose services..."
docker compose up -d --build

# Wait for PostgreSQL to accept connections
log "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U memories -d memories &>/dev/null; then
    ok "PostgreSQL is ready"
    break
  fi
  [[ $i -eq 30 ]] && fail "PostgreSQL did not become ready in 30 s"
  sleep 1
done

# Wait for Redis
log "Waiting for Redis..."
for i in $(seq 1 20); do
  if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    ok "Redis is ready"
    break
  fi
  [[ $i -eq 20 ]] && fail "Redis did not become ready in 20 s"
  sleep 1
done

# Wait for MinIO
log "Waiting for MinIO..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:9000/minio/health/live &>/dev/null; then
    ok "MinIO is ready"
    break
  fi
  [[ $i -eq 20 ]] && fail "MinIO did not become ready in 20 s"
  sleep 1
done

# ---------------------------------------------------------------------------
# 4. Run database migrations
# ---------------------------------------------------------------------------
if [[ "$NO_DB" == "false" ]]; then
  log "Running Prisma migrations..."
  docker compose exec -T app npx prisma migrate deploy
  ok "Migrations applied"
fi

# ---------------------------------------------------------------------------
# 5. Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}┌─────────────────────────────────────────────────────┐${RESET}"
echo -e "${GREEN}│  Setup complete. Services are running.               │${RESET}"
echo -e "${GREEN}│                                                       │${RESET}"
echo -e "${GREEN}│  App:    http://localhost:3000                        │${RESET}"
echo -e "${GREEN}│  Docs:   http://localhost:3000/api                    │${RESET}"
echo -e "${GREEN}│  MinIO:  http://localhost:9001  (minioadmin/minioadmin)│${RESET}"
echo -e "${GREEN}│                                                       │${RESET}"
echo -e "${GREEN}│  Unit tests:        npm test                          │${RESET}"
echo -e "${GREEN}│  Integration tests: npm run test:integration          │${RESET}"
echo -e "${GREEN}│  E2E tests:         npm run test:e2e                  │${RESET}"
echo -e "${GREEN}└─────────────────────────────────────────────────────┘${RESET}"
