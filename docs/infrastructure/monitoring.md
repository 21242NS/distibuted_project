# Monitoring

## Stack

- **Prometheus** collecte l'endpoint `/metrics` des pods backend grâce à un ServiceMonitor, déployé en dev et en test.
- **Grafana** affiche le dashboard *Photo Library*, versionné dans `platform/grafana-dashboards/photo-library.json`.

## Installation

La stack est installée par `./scripts/setup-cluster.sh` (voir [Installation du cluster local](../cluster/installation-locale.md)), via le chart Helm `kube-prometheus-stack` dans le namespace `monitoring`. Les réglages se trouvent dans `platform/monitoring-values.yaml` :

| Réglage | Valeur | Raison |
|---|---|---|
| Rétention Prometheus | 3 jours | Suffisant pour un poste de développement |
| Sélection des ServiceMonitors | Tous les namespaces | Collecte de `dev` et `test` sans label particulier |
| Dashboards Grafana | Sidecar, ConfigMaps labellisées `grafana_dashboard=1` | Dashboards versionnés dans le dépôt |
| Alertmanager, etcd, scheduler, controller-manager, kube-proxy | Désactivés | Non accessibles ou inutiles sur Docker Desktop |

La collecte du backend est déclarée par le ServiceMonitor de chaque overlay (`k8s/overlays/{dev,test}/servicemonitor.yaml`) : endpoint `/metrics` du port `http`, toutes les 15 secondes.

## Accès

| Outil | Accès |
|---|---|
| Grafana | <http://grafana.photos.localhost>, utilisateur `admin`, mot de passe défini à l'installation |
| Prometheus | `kubectl port-forward -n monitoring svc/monitoring-kube-prometheus-prometheus 9090`, puis <http://localhost:9090> |

Le dashboard **Photo Library** propose un sélecteur d'environnement (`dev` ou `test`).

## Modifier le dashboard

1. Modifier le dashboard dans Grafana, puis l'exporter en JSON (*Share → Export*).
2. Remplacer `platform/grafana-dashboards/photo-library.json`.
3. Relancer `./scripts/setup-cluster.sh` : la ConfigMap est mise à jour et Grafana recharge le dashboard.

## Métriques

Les métriques HTTP sont produites par `prometheus-fastapi-instrumentator` ; les métriques du cache sont propres à l'application.

| Métrique | Type | Description |
|---|---|---|
| `http_requests_total` | Compteur | Requêtes par route, méthode et code de statut |
| `http_request_duration_seconds` | Histogramme | Durée de traitement des requêtes |
| `photo_cache_lookups_total{cache, result}` | Compteur | Lectures dans le cache par type (`session`, `photo_list`, `photo_content`) et résultat (`hit`, `miss`, `error`) |

## Dashboard

| Panneau | Utilité |
|---|---|
| Pods backend prêts | Capacité réellement disponible |
| Réplicas voulus par l'HPA | Décisions de l'autoscaler |
| Requêtes / s (API), par route | Charge globale et répartition |
| Taux d'erreurs 5xx | Détection des incidents |
| Latence p95 | Qualité de service ressentie |
| CPU backend par pod | Utilisation par rapport à la cible de 60 % de l'HPA |
| Mémoire par pod | Risque d'arrêt pour dépassement de mémoire |
| Pods disponibles par Deployment | Vérification du rolling update |
| Redémarrages de conteneurs | Santé des pods |
| Taux de hit du cache | Efficacité de Redis |
| Lectures du cache par type et résultat | Détail hit, miss et erreurs |
| Mémoire Redis | Proximité de la limite de 96 Mo |

## Production

Le ServiceMonitor n'est pas déployé en production : la stack de monitoring du cluster de l'école n'est pas gérée par le projet. La production est surveillée par les sondes Kubernetes, le smoke test exécuté à chaque déploiement et `scripts/zero-downtime-check.sh`.
