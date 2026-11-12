# Installation du cluster local

Cette procédure installe, sur un poste de développement, un cluster Kubernetes complet : point d'entrée HTTP, autoscaling, monitoring et les environnements `dev` et `test` de l'application.

## Prérequis

| Outil | Version testée | Installation (macOS) |
|---|---|---|
| Docker Desktop | 4.x, Kubernetes activé | <https://www.docker.com/products/docker-desktop/> |
| kubectl | fourni avec Docker Desktop | – |
| Helm | 3.x | `brew install helm` |
| curl | – | préinstallé |
| jq | 1.7 | `brew install jq`, uniquement pour le runner CI |
| hey | – | `brew install hey`, uniquement pour les tests de charge |

Ressources conseillées pour Docker Desktop : 4 CPU et 8 Go de mémoire.

## 1. Activer Kubernetes

1. Ouvrir **Docker Desktop → Settings → Kubernetes**.
2. Cocher **Enable Kubernetes**, puis **Apply & restart**.
3. Vérifier :

```bash
kubectl config use-context docker-desktop
kubectl get nodes
```

Le nœud `docker-desktop` doit être à l'état `Ready`.

## 2. Installer les services de la plateforme

```bash
./scripts/setup-cluster.sh
```

Le script est idempotent : il peut être relancé sans risque, par exemple pour mettre à jour le dashboard Grafana.

| Étape | Composant | Namespace | Rôle |
|---|---|---|---|
| 1 | – | – | Vérification de Docker, kubectl et Helm |
| 2 | – | – | Vérification que le nœud est prêt |
| 3 | Dépôts Helm | – | `traefik`, `metrics-server`, `prometheus-community` |
| 4 | Traefik | `traefik` | Ingress controller, écoute sur le port 80 |
| 5 | metrics-server | `kube-system` | Mesure CPU et mémoire des pods, nécessaire à l'HPA et à `kubectl top` |
| 6 | kube-prometheus-stack | `monitoring` | Prometheus, Grafana et dashboard de l'application |

Le mot de passe administrateur de Grafana vaut `admin` par défaut. On peut le changer à l'installation :

```bash
GRAFANA_ADMIN_PASSWORD='motdepasse' ./scripts/setup-cluster.sh
```

## 3. Résolution des noms

Les environnements utilisent des sous-domaines de `photos.localhost` : `dev.photos.localhost`, `test.photos.localhost`, `grafana.photos.localhost`. Les navigateurs récents et `curl` résolvent `*.localhost` vers `127.0.0.1` sans configuration. Sinon, il faut ajouter dans `/etc/hosts` :

```text
127.0.0.1 dev.photos.localhost test.photos.localhost grafana.photos.localhost
```

## 4. Déployer l'application

```bash
./scripts/deploy.sh dev
```

| Étape | Détail |
|---|---|
| Build | Images `photo-backend` et `photo-frontend` construites localement, sans registre |
| Base de données | StatefulSets Citus, puis Pod `citus-init` |
| Migrations | Pod `db-migrate` : `alembic upgrade head` |
| Application | `kubectl apply` du rendu de `k8s/overlays/dev` |
| Rolling update | Attente de Redis, du backend et du frontend |
| Smoke test | Vérification de l'API et des pages |

L'environnement `test` se déploie de la même façon (`./scripts/deploy.sh test`), mais ses images sont publiées sur GHCR : cette étape est normalement réalisée par la CI.

## 5. Vérifier

```bash
kubectl get pods -n dev
curl http://dev.photos.localhost/api/ready
```

| Service | URL |
|---|---|
| Application (dev) | <http://dev.photos.localhost> |
| Application (test) | <http://test.photos.localhost> |
| Grafana | <http://grafana.photos.localhost> |

## Réinitialiser un environnement

En local, tous les droits sont disponibles. Pour repartir d'une base vide :

```bash
kubectl delete namespace dev
./scripts/deploy.sh dev
```

La suppression du namespace emporte les volumes persistants de la base.
