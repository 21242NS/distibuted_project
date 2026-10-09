#!/usr/bin/env bash
# Vérifie rapidement qu'un environnement répond (après un déploiement).
# Usage : ./scripts/smoke-test.sh [url]     ex: ./scripts/smoke-test.sh http://dev.photos.localhost
# Code de sortie 0 = OK, 1 = échec (utilisable par la CI).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

URL="${1:-http://dev.photos.localhost}"
require curl "brew install curl"

# check <chemin> <texte attendu dans la réponse>
check() {
  local path="$1" expected="$2" body code
  # 5 essais : laisse le temps à Traefik de prendre en compte un nouvel Ingress
  for _ in 1 2 3 4 5; do
    code="$(curl -s -o /tmp/smoke-body -w '%{http_code}' --max-time 3 "$URL$path")" || true
    [[ "$code" == "200" ]] && break
    sleep 2
  done
  [[ "$code" == "200" ]] || fail "GET $URL$path → HTTP $code"
  body="$(cat /tmp/smoke-body)"
  [[ "$body" == *"$expected"* ]] || fail "GET $URL$path → réponse inattendue : $body"
  ok "GET $path → 200"
}

log "Smoke test sur $URL"
check "/api/"          "Hello"         # backend via l'Ingress
check "/"              "Photo Library" # frontend via l'Ingress
check "/js/app.js"     "API_URL"       # fichiers statiques
rm -f /tmp/smoke-body
ok "Smoke test réussi"
