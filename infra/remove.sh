#!/usr/bin/env bash
# Stops FormCoach AI and deletes everything it created in Docker:
# containers, its network, its database volume (ALL saved workouts) and its images.
# Images that another project also uses (postgres, adminer) are kept.
#   bash infra/remove.sh        # asks for confirmation
#   bash infra/remove.sh --yes  # no questions
source "$(dirname "$0")/common.sh"

YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=1 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) fail "Unknown option: $arg" ;;
  esac
done

step "Checking prerequisites"
require_docker

if [ "$YES" -eq 0 ]; then
  printf '\n%sThis deletes the FormCoach containers, images and ALL saved workout data.%s\n' "$YELLOW" "$RESET"
  printf 'Other Docker projects are not touched. Continue? [y/N] '
  read -r answer
  case "$answer" in y|Y|yes|YES) ;; *) echo "Cancelled."; exit 0 ;; esac
fi

# Images the compose file pulls from Docker Hub (images we build are removed by --rmi local).
PULLED_IMAGES=$(sed -n 's/^[[:space:]]*image:[[:space:]]*\([^[:space:]]*\).*/\1/p' docker-compose.yml)

step "Stopping and removing containers, network, volumes and built images"
[ -f .env ] || cp .env.example .env   # compose needs it to read the file
"${COMPOSE[@]}" down --volumes --rmi local --remove-orphans
ok "Containers, network fc_net, volume fc_pgdata and the app images removed"

step "Removing downloaded base images (only if no other project uses them)"
for image in $PULLED_IMAGES; do
  if [ -n "$(docker ps -a -q --filter "ancestor=$image")" ]; then
    warn "kept $image — another container on this machine uses it"
  elif docker image inspect "$image" >/dev/null 2>&1; then
    docker image rm "$image" >/dev/null && ok "removed $image"
  fi
done

printf '\n%sFormCoach AI was removed.%s Start it again any time with: bash infra/start.sh\n\n' "$GREEN" "$RESET"
