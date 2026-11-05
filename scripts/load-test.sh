#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

load_env "${1:-test}"
DURATION="${2:-3m}"
CONCURRENCY="${3:-50}"

[[ "$ENV" != "prod" ]] || fail "pas de test de charge sur la prod : le cluster de l'école est partagé avec les autres équipes"
require hey "brew install hey"

log "Charge sur $URL/api/me pendant $DURATION ($CONCURRENCY connexions simultanées)"
log "Observe : Grafana → Photo Library (env = $ENV), ou : kubectl --context $KUBE_CONTEXT get hpa -n $NAMESPACE -w"
hey -z "$DURATION" -c "$CONCURRENCY" "$URL/api/me" \
  | grep -E "Requests/sec|Average|Slowest|Status code|\[[0-9]{3}\]"
ok "Charge terminée. L'HPA réduira le nombre de pods après ~5 min de calme."
