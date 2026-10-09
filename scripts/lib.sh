#!/usr/bin/env bash


# Contexte kubectl attendu (Docker Desktop par défaut).

KUBE_CONTEXT="${KUBE_CONTEXT:-docker-desktop}"

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

# Garde-fou : refuse de travailler sur un autre cluster que celui attendu
check_context() {
  local current
  current="$(kubectl config current-context 2>/dev/null || true)"
  [[ "$current" == "$KUBE_CONTEXT" ]] \
    || fail "contexte kubectl = '$current', attendu '$KUBE_CONTEXT' (kubectl config use-context $KUBE_CONTEXT)"
}

# Nom de domaine d'un environnement
host_for_env() {
  case "$1" in
    prod) echo "photos.localhost" ;;
    *)    echo "$1.photos.localhost" ;;
  esac
}
