#!/usr/bin/env bash
# Construit les images, les déploie dans un environnement, attend le rollout puis lance le smoke test.
# Usage : ./scripts/deploy.sh [env] [tag]
#   env : dev (défaut), test, prod → doit exister dans k8s/overlays/
#   tag : tag des images (défaut : date/heure, pour que chaque déploiement déclenche un rolling update)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

ENV="${1:-dev}"
TAG="${2:-$(date +%Y%m%d-%H%M%S)}"
OVERLAY="$ROOT_DIR/k8s/overlays/$ENV"

[[ -d "$OVERLAY" ]] || fail "environnement inconnu : '$ENV' (dossier $OVERLAY absent)"
require docker  "installe Docker Desktop"
require kubectl "fourni avec Docker Desktop"
check_context

log "1/4 Build des images (tag $TAG)"
# Docker Desktop (mode kubeadm) partage ses images avec Kubernetes : pas besoin de registry
docker build -q -t "photo-backend:$TAG"  "$ROOT_DIR/backend"  >/dev/null
docker build -q -t "photo-frontend:$TAG" "$ROOT_DIR/frontend" >/dev/null
ok "photo-backend:$TAG, photo-frontend:$TAG"

log "2/4 Déploiement dans le namespace '$ENV'"
# kustomize génère le YAML final, sed remplace le tag des images, kubectl l'applique
kubectl kustomize "$OVERLAY" \
  | sed -e "s|image: photo-backend:.*|image: photo-backend:$TAG|" \
        -e "s|image: photo-frontend:.*|image: photo-frontend:$TAG|" \
  | kubectl apply -f -

log "3/4 Attente du rolling update"
kubectl rollout status deployment/backend  -n "$ENV" --timeout=120s
kubectl rollout status deployment/frontend -n "$ENV" --timeout=120s
kubectl get pods -n "$ENV" -o wide

log "4/4 Smoke test"
"$ROOT_DIR/scripts/smoke-test.sh" "http://$(host_for_env "$ENV")"

ok "Déployé : http://$(host_for_env "$ENV")"
