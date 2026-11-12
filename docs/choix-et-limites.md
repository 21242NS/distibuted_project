# Choix techniques et limites

## Choix techniques

| Choix | Alternatives | Justification |
|---|---|---|
| Citus | PostgreSQL seul, CockroachDB | Sharding et réplication tout en restant compatible PostgreSQL : SQLAlchemy et Alembic fonctionnent sans adaptation |
| Distribution par `user_id` | Distribution par `id` | Toutes les requêtes d'un utilisateur touchent un seul shard |
| Photos stockées en base | Stockage objet (S3, MinIO) | Une seule source de données, répliquée et sauvegardée avec le reste ; aucun service supplémentaire à exploiter |
| Redis partagé | Cache en mémoire par pod | Invalidation cohérente entre tous les pods backend |
| Sessions en base | JWT | Révocation immédiate à la déconnexion |
| Kustomize | Helm | Manifests standards lisibles, patchs par environnement, intégré à `kubectl` |
| Pods ponctuels pour les migrations | Jobs, init containers | Les Jobs sont interdits sur le cluster de production ; un init container exécuterait la migration à chaque démarrage de pod |
| Promotion de l'image testée | Reconstruction pour la production | Ce qui est livré est exactement ce qui a été validé |
| Frontend sans framework | React, Vue | Aucune étape de build, image Nginx minimale, pages légères |
| FastAPI | Flask, Django | Validation des données par Pydantic, documentation OpenAPI générée, performances |

## Limites

| Limite | Conséquence | Piste d'amélioration |
|---|---|---|
| Coordinator Citus unique | Son indisponibilité interrompt l'accès à la base | Réplica de secours du coordinator, ou service managé |
| Volumes de 1 Gi non extensibles en production | Nombre de photos limité | Stockage objet pour les fichiers, la base ne gardant que les métadonnées |
| Photos servies par le backend | Charge et mémoire du backend pendant les transferts | URLs signées vers un stockage objet ou un CDN |
| Pas de HPA ni de PodDisruptionBudget en production | Capacité fixe de 3 pods | Demander ces droits aux administrateurs du cluster |
| Pas de métriques collectées en production | Surveillance limitée aux sondes et au smoke test | ServiceMonitor ou agent de métriques dans le namespace |
| Pas de TLS | Voir [Sécurité](exploitation/securite.md) | Certificat sur la gateway |
