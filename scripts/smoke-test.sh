#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

# quick check that the API and the frontend answer
URL="${1:-http://dev.photos.localhost}"
require curl "brew install curl"

# GET a path, retry 5 times, and expect a 200 containing the given text
check() {
  local path="$1" expected="$2" body code
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
check "/api/health"     "ok"
check "/"               "Photo Library"
check "/login.html"     "Connexion"
check "/js/api.js"      "API_URL"
rm -f /tmp/smoke-body
ok "Smoke test réussi"
