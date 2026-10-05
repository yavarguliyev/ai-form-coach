#!/usr/bin/env bash
# Shared helpers for start.sh / remove.sh / restart.sh. Not meant to be run directly.
# Every Docker command is scoped to this project (compose project "formcoach",
# containers fc_*, network fc_net, volume fc_pgdata) — other Docker projects are never touched.

set -euo pipefail

PROJECT="formcoach"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ---- output -------------------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi
step() { printf '\n%s==> %s%s\n' "$BOLD" "$1" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
fail() { printf '\n%s✗ %s%s\n' "$RED" "$1" "$RESET" >&2; [ $# -gt 1 ] && printf '%s\n' "${@:2}" >&2; exit 1; }

# ---- prerequisites --------------------------------------------------------------
require_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed." \
    "  Install Docker Desktop: https://www.docker.com/products/docker-desktop/" \
    "  (Linux: install Docker Engine + the Compose plugin: https://docs.docker.com/engine/install/)"

  docker info >/dev/null 2>&1 || fail "Docker is installed but not running." \
    "  Start Docker Desktop (whale icon in the menu bar / system tray), wait until it says" \
    "  'running', then run this script again. On Linux: sudo systemctl start docker"
  ok "Docker is running ($(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?'))"

  # Compose v2 ("docker compose") or the older standalone "docker-compose".
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose -p "$PROJECT")
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose -p "$PROJECT")
  else
    fail "Docker Compose is not installed." \
      "  Mac / Windows: it comes with Docker Desktop — install or update Docker Desktop." \
      "  Ubuntu / Debian: sudo apt-get update && sudo apt-get install docker-compose-plugin" \
      "  Fedora / RHEL:   sudo dnf install docker-compose-plugin" \
      "  Then check with:  docker compose version   (see README, section 1)"
  fi
  ok "Docker Compose available (${COMPOSE[0]}${COMPOSE[1]:+ ${COMPOSE[1]}})"
}

# ---- configuration ----------------------------------------------------------------
ensure_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    ok "Created .env from .env.example (ports and passwords live there)"
  else
    ok "Using existing .env"
  fi
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
  FRONTEND_PORT="${FRONTEND_PORT:-5180}"
  BACKEND_PORT="${BACKEND_PORT:-8010}"
  DB_HOST_PORT="${DB_HOST_PORT:-55432}"
  ADMINER_PORT="${ADMINER_PORT:-8090}"
}

is_running() {
  [ -n "$("${COMPOSE[@]}" ps -q 2>/dev/null)" ]
}

# True if something accepts connections on localhost:$1 (pure bash, works everywhere).
port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

check_ports() {
  local busy=0 entry name port
  for entry in "app:$FRONTEND_PORT" "api:$BACKEND_PORT" "database:$DB_HOST_PORT" "adminer:$ADMINER_PORT"; do
    name="${entry%%:*}"; port="${entry##*:}"
    if port_in_use "$port"; then
      warn "port $port ($name) is already in use by another program"
      busy=1
    else
      ok "port $port ($name) is free"
    fi
  done
  [ "$busy" -eq 0 ] || fail "A required port is busy." \
    "  Either stop the program using it, or pick another free port in the .env file" \
    "  (FRONTEND_PORT, BACKEND_PORT, DB_HOST_PORT, ADMINER_PORT) and run this script again."
}

# Wait until a container is ready: "healthy" if it has a healthcheck, else "running".
wait_healthy() {
  local container="$1" timeout="$2" waited=0 status
  while :; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo missing)"
    if [ "$status" = healthy ] || { [ "$status" = running ] && ! has_healthcheck "$container"; }; then
      ok "$container is ready"
      return 0
    fi
    if [ "$status" = exited ] || [ "$status" = dead ]; then
      fail "$container stopped unexpectedly." "  See the logs:  ${COMPOSE[*]} logs ${container#fc_}"
    fi
    if [ "$waited" -ge "$timeout" ]; then
      fail "$container did not become ready within ${timeout}s (status: $status)." \
        "  See the logs:  ${COMPOSE[*]} logs ${container#fc_}"
    fi
    sleep 3
    waited=$((waited + 3))
    if [ $((waited % 30)) -eq 0 ]; then
      printf '  %s… still waiting for %s (%ss)%s\n' "$DIM" "$container" "$waited" "$RESET"
    fi
  done
}

has_healthcheck() {
  [ "$(docker inspect -f '{{if .State.Health}}yes{{end}}' "$1" 2>/dev/null)" = yes ]
}

print_urls() {
  printf '\n%s%sFormCoach AI is running.%s\n\n' "$BOLD" "$GREEN" "$RESET"
  printf '  App        http://localhost:%s   %s(open this one — allow the camera)%s\n' "$FRONTEND_PORT" "$DIM" "$RESET"
  printf '  API docs   http://localhost:%s/docs\n' "$BACKEND_PORT"
  printf '  Database   http://localhost:%s   %s(Adminer: System PostgreSQL, Server db, user/password/database formcoach)%s\n' "$ADMINER_PORT" "$DIM" "$RESET"
  printf '\n  Stop and delete everything:  bash infra/remove.sh\n  Restart:                     bash infra/restart.sh\n\n'
}

open_browser() {
  local url="http://localhost:$FRONTEND_PORT"
  if command -v open >/dev/null 2>&1; then open "$url" >/dev/null 2>&1 || true            # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 || true  # Linux
  elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "$url" >/dev/null 2>&1 || true  # Windows
  fi
}
