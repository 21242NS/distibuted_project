#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

# usage: ./scripts/promote_prod.sh <tag validated in test>
TAG="${1:?Usage : $0 <tag validé en test>   ex: $0 sha-abc1234}"
load_env prod
require docker  "installe Docker Desktop"
require kubectl "fourni avec Docker Desktop"
check_context

# never deploy an image that was not tested
log "Vérification que les images $TAG existent sur la registry"
for app in backend frontend; do
  docker buildx imagetools inspect "${IMAGE_PREFIX}photo-$app:$TAG" >/dev/null 2>&1 \
    || fail "${IMAGE_PREFIX}photo-$app:$TAG introuvable : cette version n'a pas été déployée en test"
done
ok "images présentes (amd64 + arm64)"

# same deployment as test, on the school cluster
deploy_overlay "$TAG"
