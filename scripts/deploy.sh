#!/usr/bin/env bash
# Construit les images, les déploie dans un environnement local, attend le rollout puis lance le smoke test.
# Usage : ./scripts/deploy.sh [env] [tag]
#   env : dev (défaut) ou test. La prod se déploie avec promote_prod.sh (sans rebuild).
#   tag : tag des images (défaut : date/heure, pour que chaque déploiement déclenche un rolling update)
#
#   dev  : build local, image visible directement par Docker Desktop (rapide, hors ligne)
#   test : build multi-architecture (amd64 + arm64) poussé sur GHCR → la prod réutilisera CETTE image
set -euo pipefail
source "$(dirname "$0")/lib.sh"

load_env "${1:-dev}"
TAG="${2:-$(date +%Y%m%d-%H%M%S)}"

[[ "$ENV" != "prod" ]] || fail "la prod ne se build pas : ./scripts/promote_prod.sh <tag validé en test>"
require docker  "installe Docker Desktop"
require kubectl "fourni avec Docker Desktop"
check_context

log "Build des images (tag $TAG)"
if [[ -z "$IMAGE_PREFIX" ]]; then
  # dev : Docker Desktop partage ses images avec Kubernetes, pas besoin de registry
  docker build -q -t "photo-backend:$TAG"  "$ROOT_DIR/backend"  >/dev/null
  docker build -q -t "photo-frontend:$TAG" "$ROOT_DIR/frontend" >/dev/null
else
  # Dans GitHub Actions, on se connecte avec le token du job.
  # En local, il faut s'être connecté une fois : docker login ghcr.io
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin >/dev/null
  fi
  for app in backend frontend; do
    docker buildx build --quiet --platform linux/amd64,linux/arm64 \
      -t "${IMAGE_PREFIX}photo-$app:$TAG" --push "$ROOT_DIR/$app" >/dev/null
  done
fi
ok "${IMAGE_PREFIX}photo-backend:$TAG, ${IMAGE_PREFIX}photo-frontend:$TAG"

deploy_overlay "$TAG"
