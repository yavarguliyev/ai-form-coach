#!/usr/bin/env bash
# Adds 3 weeks of example workouts for "Demo User" so the History page has charts to show.
# Your real workouts are never touched; running it again replaces only the example ones.
#   bash infra/demo-data.sh            # add / refresh the example workouts
#   bash infra/demo-data.sh --remove   # delete only the example workouts
source "$(dirname "$0")/common.sh"

ARGS=()
for arg in "$@"; do
  case "$arg" in
    --remove) ARGS+=(--remove) ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) fail "Unknown option: $arg" ;;
  esac
done

require_docker >/dev/null
is_running || fail "FormCoach is not running." "  Start it first:  bash infra/start.sh"
"${COMPOSE[@]}" exec -T backend python -m app.demo_data ${ARGS[@]+"${ARGS[@]}"}
