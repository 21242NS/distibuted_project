#!/usr/bin/env bash
# Prépare le cluster local (Docker Desktop, kubeadm) : à lancer une fois, relançable sans risque.
# Installe : Traefik (Ingress Controller), metrics-server (CPU/RAM, HPA),
#            kube-prometheus-stack (Prometheus + Grafana) et le dashboard "Photo Library".
# Usage : ./scripts/setup-cluster.sh
#         GRAFANA_ADMIN_PASSWORD=... ./scripts/setup-cluster.sh   (défaut : admin)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-admin}"

log "1/6 Vérification des outils"
require docker  "installe Docker Desktop"
require kubectl "fourni avec Docker Desktop"
require helm    "brew install helm"
docker info >/dev/null 2>&1 || fail "Docker ne tourne pas : lance Docker Desktop"
ok "docker, kubectl, helm"

log "2/6 Vérification du cluster"
load_env dev   # setup = cluster local uniquement
check_context
k wait --for=condition=Ready node --all --timeout=60s >/dev/null \
  || fail "le nœud n'est pas Ready (Docker Desktop > Settings > Kubernetes)"
ok "cluster '$KUBE_CONTEXT' prêt"

log "3/6 Dépôts Helm"
helm repo add traefik https://traefik.github.io/charts >/dev/null 2>&1 || true
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ >/dev/null 2>&1 || true
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
helm repo update >/dev/null
ok "traefik, metrics-server, prometheus-community"

log "4/6 Ingress Controller Traefik"
# upgrade --install = installe si absent, met à jour sinon (idempotent)
helm upgrade --install traefik traefik/traefik --kube-context "$KUBE_CONTEXT" \
  --namespace traefik --create-namespace --wait >/dev/null
for _ in $(seq 1 15); do              # quelques secondes si le pod Traefik vient d'être remplacé
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$URL/")" || true
  [[ "$code" != "000" ]] && break
  sleep 2
done
[[ "$code" != "000" ]] || fail "Traefik ne répond pas sur $URL (kubectl get svc -n traefik)"
ok "Traefik répond sur le port 80"

log "5/6 metrics-server (CPU/RAM des pods, nécessaire à l'HPA)"
# Docker Desktop : le kubelet a un certificat auto-signé → --kubelet-insecure-tls
helm upgrade --install metrics-server metrics-server/metrics-server --kube-context "$KUBE_CONTEXT" \
  --namespace kube-system --set 'args={--kubelet-insecure-tls}' --wait >/dev/null
ok "metrics-server installé (kubectl top pods disponible d'ici ~1 min)"

log "6/6 Monitoring : Prometheus + Grafana"
helm upgrade --install monitoring prometheus-community/kube-prometheus-stack --kube-context "$KUBE_CONTEXT" \
  --namespace monitoring --create-namespace \
  -f "$ROOT_DIR/platform/monitoring-values.yaml" \
  --set grafana.adminPassword="$GRAFANA_ADMIN_PASSWORD" \
  --wait --timeout 10m >/dev/null
# Le dashboard versionné dans Git, importé automatiquement par le sidecar de Grafana (label grafana_dashboard)
k create configmap grafana-dashboard-photo-library -n monitoring \
  --from-file="$ROOT_DIR/platform/grafana-dashboards/photo-library.json" \
  --dry-run=client -o yaml \
  | k label --local -f - grafana_dashboard=1 -o yaml \
  | k apply -f - >/dev/null
ok "Grafana : http://grafana.photos.localhost  (admin / $GRAFANA_ADMIN_PASSWORD)"

ok "Cluster prêt. Étape suivante : ./scripts/deploy.sh dev"
