# Photo Library Service

Photo Library Service est une application web de bibliothèque photo. Chaque utilisateur crée un compte, importe ses images, les consulte dans une galerie et repère les doublons. L'application tourne sur Kubernetes, et une chaîne d'intégration et de déploiement continus mène chaque modification du `git push` jusqu'à la production, sans interruption de service.

| | |
|---|---|
| **Production** | <http://team3.laboinfo-ecam.be> |
| **Code source** | <https://github.com/21242NS/distibuted_project> |

## Fonctionnalités

- Création de compte et connexion, la session étant ouverte dès l'inscription
- Import de photos par sélection ou glisser-déposer (JPEG, PNG, GIF, WebP, jusqu'à 10 Mo)
- Galerie adaptée à toutes les tailles d'écran, visionneuse plein écran avec lien direct vers chaque photo
- Détection des doublons par empreinte SHA-256 et suppression des copies en un clic
- Sélection multiple et suppression groupée

## Contenu de la documentation

| Sujet | Pages |
|---|---|
| Installation du cluster | [Cluster local](cluster/installation-locale.md) · [Migration vers le cloud](cluster/migration-cloud.md) · [Environnements](infrastructure/kubernetes.md) |
| Pipeline CI/CD | [Du push à la production](pipeline.md) · [Zéro downtime](zero-downtime.md) |
| Base de données | [Sharding et réplication](infrastructure/base-de-donnees.md) · [Migrations de schéma](migrations.md) · [Refresh de la base de test](refresh-test.md) |
| Monitoring et scaling | [Monitoring](infrastructure/monitoring.md) · [Scaling](infrastructure/scaling.md) |
| Nouveaux développeurs | [Onboarding](onboarding.md) |
| Application | [API](application/api.md) · [Sessions](application/sessions.md) · [Cache Redis](infrastructure/cache.md) |
| Exploitation | [Runbook](exploitation/runbook.md) · [Sécurité](exploitation/securite.md) · [Choix et limites](choix-et-limites.md) |

## Stack technique

| Couche | Technologie |
|---|---|
| Frontend | HTML, CSS et JavaScript sans framework, servi par Nginx |
| Backend | Python 3.12, FastAPI, SQLAlchemy, Alembic |
| Base de données | Citus (PostgreSQL distribué) : 1 coordinator, 2 workers |
| Cache | Redis 7.4 |
| Orchestration | Kubernetes, Kustomize |
| CI/CD | GitHub Actions, GitHub Container Registry |
| Monitoring | Prometheus, Grafana |
