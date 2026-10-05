#!/usr/bin/env bash
# Builds and starts FormCoach AI in Docker, waits until it is ready, and opens the app.
#   bash infra/start.sh             # start (safe to run again: it just updates/rebuilds)
#   bash infra/start.sh --no-open   # don't open the browser
source "$(dirname "$0")/common.sh"

OPEN=1
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN=0 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) fail "Unknown option: $arg" ;;
  esac
done

step "Checking prerequisites"
require_docker

step "Preparing configuration"
ensure_env

step "Checking ports"
if is_running; then
  ok "FormCoach is already running — its ports are in use by itself (fine)"
else
  check_ports
fi

step "Building and starting containers (first run downloads ~1 GB and can take a few minutes)"
"${COMPOSE[@]}" up --build -d

step "Waiting for the services to be ready"
wait_healthy fc_db 120
wait_healthy fc_backend 300
wait_healthy fc_frontend 600   # first start installs packages and downloads the pose model
wait_healthy fc_adminer 60

print_urls
[ "$OPEN" -eq 1 ] && open_browser
exit 0
