#!/usr/bin/env bash
# Fonctions communes, chargées par les autres scripts avec : source "$(dirname "$0")/lib.sh"

# Registry où sont publiées les images (test et prod les téléchargent depuis ici)
REGISTRY="${REGISTRY:-ghcr.io/21242ns}"

# Racine du repo, pour que les scripts marchent depuis n'importe quel dossier
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { echo -e "\033[1;34m[INFO]\033[0m $*"; }
ok()   { echo -e "\033[1;32m[ OK ]\033[0m $*"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $*"; }
fail() { echo -e "\033[1;31m[FAIL]\033[0m $*" >&2; exit 1; }

# Vérifie qu'un outil est installé
require() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' n'est pas installé ($2)"
}

# ── Configuration par environnement ─────────────────────────────────────────
# dev/test : cluster local Docker Desktop ; prod : cluster de l'école (OVH)

context_for_env() {
  case "$1" in
    prod) echo "team3@cluster-sc" ;;
    *)    echo "docker-desktop" ;;
  esac
}

namespace_for_env() {
  case "$1" in
    prod) echo "team3" ;;
    *)    echo "$1" ;;
  esac
}

url_for_env() {
  case "$1" in
    prod) echo "https://team3.laboinfo-ecam.be" ;;
    *)    echo "http://$1.photos.localhost" ;;
  esac
}

# Préfixe des images : dev utilise les images locales, test/prod celles de la registry
image_prefix_for_env() {
  case "$1" in
    dev) echo "" ;;
    *)   echo "$REGISTRY/" ;;
  esac
}

# ── kubectl sur un cluster précis ───────────────────────────────────────────
# On ne change JAMAIS le contexte global (kubectl config use-context) :
# chaque commande précise son cluster, impossible de se tromper de cible.

k() { kubectl --context "$KUBE_CONTEXT" "$@"; }

# Vérifie que le contexte existe dans ~/.kube/config et que le cluster répond
check_context() {
  kubectl config get-contexts "$KUBE_CONTEXT" >/dev/null 2>&1 \
    || fail "contexte '$KUBE_CONTEXT' absent de ~/.kube/config (kubectl config get-contexts)"
  k get --raw /readyz --request-timeout=10s >/dev/null 2>&1 \
    || k get pods -n "$NAMESPACE" --request-timeout=10s >/dev/null \
    || fail "le cluster '$KUBE_CONTEXT' ne répond pas"
}

# Charge la config d'un environnement dans des variables globales
load_env() {
  ENV="$1"
  OVERLAY="$ROOT_DIR/k8s/overlays/$ENV"
  [[ -d "$OVERLAY" ]] || fail "environnement inconnu : '$ENV' (dossier $OVERLAY absent)"
  KUBE_CONTEXT="${KUBE_CONTEXT:-$(context_for_env "$ENV")}"
  NAMESPACE="$(namespace_for_env "$ENV")"
  URL="$(url_for_env "$ENV")"
  IMAGE_PREFIX="$(image_prefix_for_env "$ENV")"
}

# Applique l'overlay avec le tag donné, attend le rolling update, lance le smoke test
deploy_overlay() {
  local tag="$1"

  log "Déploiement de '$ENV' (cluster $KUBE_CONTEXT, namespace $NAMESPACE, tag $tag)"
  # kustomize génère le YAML final, sed impose le nom complet + tag des images, kubectl l'applique
  kubectl kustomize "$OVERLAY" \
    | sed -E -e "s#image: [^[:space:]]*photo-backend:[^[:space:]]*#image: ${IMAGE_PREFIX}photo-backend:${tag}#" \
             -e "s#image: [^[:space:]]*photo-frontend:[^[:space:]]*#image: ${IMAGE_PREFIX}photo-frontend:${tag}#" \
    | k apply -f -

  log "Attente du rolling update"
  k rollout status deployment/backend  -n "$NAMESPACE" --timeout=180s
  k rollout status deployment/frontend -n "$NAMESPACE" --timeout=180s
  k get pods -n "$NAMESPACE" -o wide

  log "Smoke test"
  "$ROOT_DIR/scripts/smoke-test.sh" "$URL"
  ok "Déployé : $URL"
}
