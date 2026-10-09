#!/usr/bin/env bash
# vérifie les outils, le cluster Docker Desktop (kubeadm), installe Traefik et vérifie qu'il répond.
# Usage : ./scripts/setup-cluster.sh
set -euo pipefail
source "$(dirname "$0")/lib.sh"

log "1/4 Vérification des outils"
require docker  "installe Docker Desktop"
require kubectl "fourni avec Docker Desktop"
require helm    "brew install helm"
docker info >/dev/null 2>&1 || fail "Docker ne tourne pas : lance Docker Desktop"
ok "docker, kubectl, helm"

log "2/4 Vérification du cluster"
check_context
kubectl wait --for=condition=Ready node --all --timeout=60s >/dev/null \
  || fail "le nœud n'est pas Ready (Docker Desktop > Settings > Kubernetes)"
ok "cluster '$KUBE_CONTEXT' prêt"

log "3/4 Installation de l'Ingress Controller Traefik"
helm repo add traefik https://traefik.github.io/charts >/dev/null 2>&1 || true
helm repo update traefik >/dev/null
# upgrade --install = installe si absent, met à jour sinon (idempotent)
helm upgrade --install traefik traefik/traefik \
  --namespace traefik --create-namespace --wait >/dev/null
ok "Traefik installé (IngressClass : $(kubectl get ingressclass -o name | tr '\n' ' '))"

log "4/4 Vérification de l'accès à Traefik"
# Les noms en *.localhost pointent automatiquement vers 127.0.0.1 (pas besoin de /etc/hosts).
# Traefik doit répondre (404 tant qu'aucun Ingress n'existe pour ce nom, c'est normal).
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://$(host_for_env dev)/")" || true
[[ "$code" != "000" ]] || fail "Traefik ne répond pas sur http://$(host_for_env dev) (kubectl get svc -n traefik)"
ok "Traefik répond sur le port 80"

ok "Cluster prêt. Étape suivante : ./scripts/deploy.sh dev"
