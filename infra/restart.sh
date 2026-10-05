#!/usr/bin/env bash
# Restarts FormCoach AI: stops the containers and starts them again (rebuilding if code changed).
# Saved workouts are KEPT. Use this if the app gets stuck or after pulling new code.
#   bash infra/restart.sh [--no-open]
source "$(dirname "$0")/common.sh"

step "Checking prerequisites"
require_docker
ensure_env

step "Stopping containers (data is kept)"
"${COMPOSE[@]}" down --remove-orphans
ok "Stopped"

exec bash "$(dirname "$0")/start.sh" "$@"
