# Photo Library Service

Application web de bibliothèque photo déployée sur Kubernetes, avec une chaîne CI/CD qui mène chaque `git push` jusqu'à la production sans interruption de service.

| | |
|---|---|
| **Production** | <http://team3.laboinfo-ecam.be> |
| **Documentation** | <https://21242ns.github.io/distibuted_project/> (sources dans [`docs/`](docs/index.md)) |

## Fonctionnalités

- Inscription, connexion et sessions sécurisées (cookie HttpOnly, mots de passe hachés en Argon2)
- Import de photos par sélection ou glisser-déposer, avec affichage immédiat (optimiste)
- Galerie, visionneuse plein écran, sélection multiple et suppression groupée
- Albums : plusieurs collections par utilisateur
- Détection des doublons par empreinte SHA-256 et nettoyage en un clic

## Architecture

```
            Ingress (Traefik) / Gateway API en production
                 │                         │
            /api │                         │ /
                 ▼                         ▼
         Backend FastAPI ×N          Frontend Nginx ×2
          │            │
          ▼            ▼
   Redis (cache)   Citus coordinator
                     │          │
                     ▼          ▼
                 worker 0    worker 1     (shards répliqués ×2)
```

| Couche | Technologie |
|---|---|
| Frontend | HTML, CSS, JavaScript sans framework, servi par Nginx |
| Backend | Python 3.12, FastAPI, SQLAlchemy, Alembic |
| Base de données | Citus (PostgreSQL distribué) : 1 coordinator, 2 workers |
| Cache | Redis 7.4 |
| Orchestration | Kubernetes, Kustomize (overlays `dev`, `test`, `prod`) |
| CI/CD | GitHub Actions, GitHub Container Registry |
| Monitoring | Prometheus, Grafana |

Détails : [Architecture](docs/architecture.md).

## Environnements

| Environnement | Cluster | URL |
|---|---|---|
| dev | Docker Desktop | <http://dev.photos.localhost> |
| test | Docker Desktop | <http://test.photos.localhost> |
| prod | Cluster de l'école (namespace `team3`) | <http://team3.laboinfo-ecam.be> |

## Démarrage rapide

Prérequis : Docker Desktop avec Kubernetes activé, Helm, Python 3.12.

```bash
git clone https://github.com/21242NS/distibuted_project.git
cd distibuted_project

./scripts/setup-cluster.sh   # Traefik, metrics-server, Prometheus et Grafana
./scripts/deploy.sh dev      # build des images et déploiement sur dev
```

L'application est alors disponible sur <http://dev.photos.localhost> et Grafana sur <http://grafana.photos.localhost>.

Tests du backend :

```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
pytest
```

Guide complet : [Onboarding](docs/onboarding.md).

## Pipeline CI/CD

Un push sur `main` déclenche [`.github/workflows/ci-cd.yaml`](.github/workflows/ci-cd.yaml) :

1. **tests** : tests unitaires du backend
2. **deploy-test** : build multi-architecture, push sur GHCR avec le tag `sha-<commit>`, migrations de schéma, rolling update et smoke test sur test
3. **deploy-prod** : promotion des images validées en test, sans rebuild

Détails : [Pipeline](docs/pipeline.md) · [Zéro downtime](docs/zero-downtime.md) · [Migrations](docs/migrations.md).

## Structure du dépôt

| Dossier | Contenu |
|---|---|
| [`backend/`](backend/) | API FastAPI, migrations Alembic, tests |
| [`frontend/`](frontend/) | Pages HTML, CSS et JavaScript |
| [`k8s/`](k8s/) | Manifests Kubernetes : `base`, composant `citus`, overlays, tâches ponctuelles |
| [`platform/`](platform/) | Configuration du monitoring et dashboard Grafana |
| [`scripts/`](scripts/) | Installation du cluster, déploiement, refresh de la base de test, tests de charge |
| [`docs/`](docs/index.md) | Documentation (MkDocs) |

## Documentation

| Sujet | Pages |
|---|---|
| Installation du cluster | [Cluster local](docs/cluster/installation-locale.md) · [Migration vers le cloud](docs/cluster/migration-cloud.md) · [Environnements Kubernetes](docs/infrastructure/kubernetes.md) |
| Pipeline CI/CD | [Du push à la production](docs/pipeline.md) · [Zéro downtime](docs/zero-downtime.md) |
| Base de données | [Sharding et réplication](docs/infrastructure/base-de-donnees.md) · [Migrations](docs/migrations.md) · [Refresh de la base de test](docs/refresh-test.md) |
| Monitoring et scaling | [Monitoring](docs/infrastructure/monitoring.md) · [Scaling](docs/infrastructure/scaling.md) |
| Nouveaux développeurs | [Onboarding](docs/onboarding.md) |
| Application | [API](docs/application/api.md) · [Sessions](docs/application/sessions.md) · [Cache Redis](docs/infrastructure/cache.md) |
| Exploitation | [Runbook](docs/exploitation/runbook.md) · [Sécurité](docs/exploitation/securite.md) · [Choix et limites](docs/choix-et-limites.md) |

Pour consulter la documentation en local :

```bash
pip install -r docs/requirements.txt
mkdocs serve   # http://127.0.0.1:8000
```
