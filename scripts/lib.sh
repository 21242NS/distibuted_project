#!/usr/bin/env bash

REGISTRY="${REGISTRY:-ghcr.io/21242ns}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { echo -e "\033[1;34m[INFO]\033[0m $*"; }
ok()   { echo -e "\033[1;32m[ OK ]\033[0m $*"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $*"; }
fail() { echo -e "\033[1;31m[FAIL]\033[0m $*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' n'est pas installé ($2)"
}

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
    prod) echo "http://team3.laboinfo-ecam.be" ;;
    *)    echo "http://$1.photos.localhost" ;;
  esac
}

image_prefix_for_env() {
  case "$1" in
    dev) echo "" ;;
    *)   echo "$REGISTRY/" ;;
  esac
}

k() { kubectl --context "$KUBE_CONTEXT" "$@"; }

check_context() {
  kubectl config get-contexts "$KUBE_CONTEXT" >/dev/null 2>&1 \
    || fail "contexte '$KUBE_CONTEXT' absent de ~/.kube/config (kubectl config get-contexts)"
  k get --raw /readyz --request-timeout=10s >/dev/null 2>&1 \
    || k get pods -n "$NAMESPACE" --request-timeout=10s >/dev/null \
    || fail "le cluster '$KUBE_CONTEXT' ne répond pas"
}

load_env() {
  ENV="$1"
  OVERLAY="$ROOT_DIR/k8s/overlays/$ENV"
  [[ -d "$OVERLAY" ]] || fail "environnement inconnu : '$ENV' (dossier $OVERLAY absent)"
  KUBE_CONTEXT="${KUBE_CONTEXT:-$(context_for_env "$ENV")}"
  NAMESPACE="$(namespace_for_env "$ENV")"
  URL="$(url_for_env "$ENV")"
  IMAGE_PREFIX="$(image_prefix_for_env "$ENV")"
}

deploy_overlay() {
  local tag="$1" rendered

  log "Déploiement de '$ENV' (cluster $KUBE_CONTEXT, namespace $NAMESPACE, tag $tag)"
  rendered="$(kubectl kustomize "$OVERLAY" \
    | sed -E -e "s#image: [^[:space:]]*photo-backend:[^[:space:]]*#image: ${IMAGE_PREFIX}photo-backend:${tag}#" \
             -e "s#image: [^[:space:]]*photo-frontend:[^[:space:]]*#image: ${IMAGE_PREFIX}photo-frontend:${tag}#")"

  if grep -q "name: citus-coordinator" <<<"$rendered"; then
    deploy_database "$rendered"
    run_migrations "${IMAGE_PREFIX}photo-backend:${tag}"
  fi

  log "Application"
  k apply -f - <<<"$rendered"

  log "Attente du rolling update"
  k rollout status deployment/backend  -n "$NAMESPACE" --timeout=180s
  k rollout status deployment/frontend -n "$NAMESPACE" --timeout=180s
  k get pods -n "$NAMESPACE" -o wide

  log "Smoke test"
  "$ROOT_DIR/scripts/smoke-test.sh" "$URL"
  ok "Déployé : $URL"
}

deploy_database() {
  local rendered="$1"
  log "Base de données Citus (coordinator + workers)"
  if ! k get namespace "$NAMESPACE" >/dev/null 2>&1 && k auth can-i create namespaces >/dev/null 2>&1; then
    k create namespace "$NAMESPACE"
  fi
  k apply -l tier=database -f - <<<"$rendered"
  k rollout status statefulset/citus-coordinator -n "$NAMESPACE" --timeout=300s
  k rollout status statefulset/citus-worker      -n "$NAMESPACE" --timeout=300s
  init_citus
  ok "base de données prête"
}

init_citus() {
  local workers
  workers="$(k get statefulset citus-worker -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')"
  run_task citus-init "s#WORKER_COUNT#${workers}#" "initialisation de Citus"
}

run_migrations() {
  run_task db-migrate "s#BACKEND_IMAGE#$1#" "migrations de schéma (alembic upgrade head)"
}

run_task() {
  local name="$1" substitution="$2" description="$3" phase=""
  log "Tâche : $description"
  k delete pod "$name" -n "$NAMESPACE" --ignore-not-found --wait=true >/dev/null
  sed "$substitution" "$ROOT_DIR/k8s/tasks/$name.yaml" | k apply -n "$NAMESPACE" -f - >/dev/null
  for _ in $(seq 1 150); do
    phase="$(k get pod "$name" -n "$NAMESPACE" -o jsonpath='{.status.phase}')"
    [[ "$phase" == "Succeeded" || "$phase" == "Failed" ]] && break
    sleep 2
  done
  k logs "pod/$name" -n "$NAMESPACE" --tail=20 2>/dev/null | sed 's/^/    /' || true
  [[ "$phase" == "Succeeded" ]] || fail "$description : échec ($phase), déploiement annulé, l'ancienne version continue de tourner"
  ok "$description : terminé"
}
