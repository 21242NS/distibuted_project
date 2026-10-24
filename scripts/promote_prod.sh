#!/usr/bin/env bash
# Promeut en production (cluster de l'école) une version DÉJÀ validée en test.
# Ne reconstruit rien : déploie exactement l'image poussée sur GHCR par deploy.sh test ("build once, deploy many").
# Usage : ./scripts/promote_prod.sh <tag>     ex: ./scripts/promote_prod.sh sha-abc1234
set -euo pipefail
source "$(dirname "$0")/lib.sh"

TAG="${1:?Usage : $0 <tag validé en test>   ex: $0 sha-abc1234}"
load_env prod
require docker  "installe Docker Desktop"
require kubectl "fourni avec Docker Desktop"
check_context

log "Vérification que les images $TAG existent sur la registry"
for app in backend frontend; do
  docker buildx imagetools inspect "${IMAGE_PREFIX}photo-$app:$TAG" >/dev/null 2>&1 \
    || fail "${IMAGE_PREFIX}photo-$app:$TAG introuvable : cette version n'a pas été déployée en test"
done
ok "images présentes (amd64 + arm64)"

deploy_overlay "$TAG"
