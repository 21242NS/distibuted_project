#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

load_env "${1:-test}"
DURATION="${2:-0}"
require curl "brew install curl"

TOTAL=0
ERRORS=0
START=$(date +%s)

summary() {
  echo
  if [[ "$ERRORS" -eq 0 ]]; then
    ok "$TOTAL requêtes, 0 erreur : aucune interruption de service"
  else
    warn "$TOTAL requêtes, $ERRORS erreur(s)"
  fi
}
trap summary EXIT

log "Requêtes en continu sur $URL/ et $URL/api/health (Ctrl+C pour arrêter)"
while [[ "$DURATION" -eq 0 || $(( $(date +%s) - START )) -lt "$DURATION" ]]; do
  for path in / /api/health; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$URL$path")" || code="000"
    TOTAL=$((TOTAL + 1))
    if [[ "$code" != "200" ]]; then
      ERRORS=$((ERRORS + 1))
      echo "$(date +%T) GET $path → HTTP $code"
    fi
  done
  sleep 0.05
done
