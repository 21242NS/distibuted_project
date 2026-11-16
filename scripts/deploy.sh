#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

# usage: ./scripts/deploy.sh <dev|test> [tag]
load_env "${1:-dev}"
TAG="${2:-$(date +%Y%m%d-%H%M%S)}"

# prod only receives images already validated in test
[[ "$ENV" != "prod" ]] || fail "la prod ne se build pas : ./scripts/promote_prod.sh <tag validé en test>"
require docker  "installe Docker Desktop"
require kubectl "fourni avec Docker Desktop"
check_context

log "Build des images (tag $TAG)"
# dev: local images, test: multi-arch images pushed to GHCR
if [[ -z "$IMAGE_PREFIX" ]]; then
  docker build -q -t "photo-backend:$TAG"  "$ROOT_DIR/backend"  >/dev/null
  docker build -q -t "photo-frontend:$TAG" "$ROOT_DIR/frontend" >/dev/null
else
  # CI: log in to GHCR with a temporary docker config
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    require jq "brew install jq"
    DOCKER_CONFIG="$(mktemp -d)"
    export DOCKER_CONFIG
    export PATH="$ROOT_DIR/scripts/ci:$PATH"
    trap 'rm -rf "$DOCKER_CONFIG"' EXIT
    jq 'del(.credHelpers, .auths) | .credsStore = "cifile"' "$HOME/.docker/config.json" > "$DOCKER_CONFIG/config.json"
    for dir in contexts cli-plugins buildx; do
      [[ -e "$HOME/.docker/$dir" ]] && ln -s "$HOME/.docker/$dir" "$DOCKER_CONFIG/$dir"
    done
    echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin >/dev/null
  fi
  for app in backend frontend; do
    docker buildx build --quiet --platform linux/amd64,linux/arm64 \
      -t "${IMAGE_PREFIX}photo-$app:$TAG" --push "$ROOT_DIR/$app" >/dev/null
  done
fi
ok "${IMAGE_PREFIX}photo-backend:$TAG, ${IMAGE_PREFIX}photo-frontend:$TAG"

# deploy the new images
deploy_overlay "$TAG"
