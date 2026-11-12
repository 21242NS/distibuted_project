#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

SOURCE_ENV="${1:-prod}"
TEST_PASSWORD="${TEST_PASSWORD:-TestPhotos2026}"

[[ "$SOURCE_ENV" == "prod" || "$SOURCE_ENV" == "dev" ]] || fail "source inconnue : '$SOURCE_ENV' (prod ou dev)"
require kubectl "fourni avec Docker Desktop"
require python3 "brew install python"
require curl    "brew install curl"

SRC_CONTEXT="$(context_for_env "$SOURCE_ENV")"
SRC_NS="$(namespace_for_env "$SOURCE_ENV")"
DST_CONTEXT="$(context_for_env test)"
DST_NS="$(namespace_for_env test)"
DST_URL="$(url_for_env test)"

[[ "$DST_NS" == "test" && "$DST_CONTEXT" != "$(context_for_env prod)" ]] \
  || fail "la cible doit être l'environnement de test, jamais la production"

src() { kubectl --context "$SRC_CONTEXT" -n "$SRC_NS" "$@"; }
dst() { kubectl --context "$DST_CONTEXT" -n "$DST_NS" "$@"; }
dst_sql() { dst exec -i citus-coordinator-0 -- psql -v ON_ERROR_STOP=1 -qAt -U postgres -d photos "$@"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; src delete pod db-export --ignore-not-found --wait=false >/dev/null 2>&1 || true' EXIT

log "Refresh de la base de test depuis '$SOURCE_ENV' ($SRC_CONTEXT, namespace $SRC_NS)"
dst get pod citus-coordinator-0 >/dev/null 2>&1 || fail "base de test absente : lance d'abord ./scripts/deploy.sh test"

log "1/5 Export anonymisé depuis '$SOURCE_ENV' (lecture seule)"
src delete pod db-export --ignore-not-found --wait=true >/dev/null
src apply -f "$ROOT_DIR/k8s/tasks/db-export.yaml" >/dev/null
phase=""
for _ in $(seq 1 90); do
  phase="$(src get pod db-export -o jsonpath='{.status.phase}')"
  [[ "$phase" == "Succeeded" || "$phase" == "Failed" ]] && break
  sleep 2
done
src logs pod/db-export > "$WORK/export.txt"
[[ "$phase" == "Succeeded" ]] || { tail -20 "$WORK/export.txt" >&2; fail "export : échec ($phase), la base de test n'a pas été modifiée"; }
src delete pod db-export --wait=false >/dev/null
SRC_SCHEMA="$(python3 "$ROOT_DIR/scripts/build_test_dataset.py" "$WORK/export.txt" --schema)"
ok "export terminé (schéma $SRC_SCHEMA)"

log "2/5 Vérification de la compatibilité des schémas"
DST_SCHEMA="$(dst_sql -c "SELECT version_num FROM alembic_version")"
[[ "$SRC_SCHEMA" == "$DST_SCHEMA" ]] \
  || fail "schémas différents ($SOURCE_ENV : $SRC_SCHEMA, test : $DST_SCHEMA) : déploie la même version en test avant le refresh"
ok "schéma $DST_SCHEMA des deux côtés"

log "3/5 Construction du jeu de données"
PASSWORD_HASH="$(dst exec deploy/backend -- python -c \
  "import sys; from app.routers.login import hash_password; print(hash_password(sys.argv[1]))" "$TEST_PASSWORD")"
python3 "$ROOT_DIR/scripts/build_test_dataset.py" "$WORK/export.txt" --password-hash "$PASSWORD_HASH" > "$WORK/dataset.sql"
ok "$(du -h "$WORK/dataset.sql" | cut -f1 | tr -d ' ') de SQL généré"

log "4/5 Remplacement des données de test (une seule transaction)"
dst_sql < "$WORK/dataset.sql" >/dev/null
if dst get deployment redis >/dev/null 2>&1; then
  dst exec deploy/redis -- redis-cli flushall >/dev/null
  ok "cache Redis vidé"
fi
USERS="$(dst_sql -c "SELECT count(*) FROM users")"
PHOTOS="$(dst_sql -c "SELECT count(*) FROM photos")"
ok "$USERS utilisateurs, $PHOTOS photos"

log "5/5 Vérification"
"$ROOT_DIR/scripts/smoke-test.sh" "$DST_URL" >/dev/null
FIRST_USER="$(dst_sql -c "SELECT username FROM users ORDER BY id LIMIT 1")"
if [[ -n "$FIRST_USER" ]]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
    -d "{\"username\":\"$FIRST_USER\",\"password\":\"$TEST_PASSWORD\"}" "$DST_URL/api/login")"
  [[ "$code" == "200" ]] || fail "connexion de $FIRST_USER impossible (HTTP $code)"
  ok "connexion de $FIRST_USER réussie"
fi

ok "Base de test rafraîchie : $DST_URL (comptes user_<id>, mot de passe : $TEST_PASSWORD)"
