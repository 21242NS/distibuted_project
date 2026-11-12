# Kubernetes et environnements

## Environnements

| | dev | test | prod |
|---|---|---|---|
| Cluster | Docker Desktop | Docker Desktop | OVH (cluster de l'ECAM) |
| Contexte `kubectl` | `docker-desktop` | `docker-desktop` | `team3@cluster-sc` |
| Namespace | `dev` | `test` | `team3` |
| URL | <http://dev.photos.localhost> | <http://test.photos.localhost> | <http://team3.laboinfo-ecam.be> |
| Images | Construites localement | GHCR | GHCR, identiques à celles validées en test |
| Exposition | Ingress Traefik | Ingress Traefik | HTTPRoute (Gateway API) |
| Backend | HPA, 2 à 8 pods | HPA, 2 à 8 pods | 3 réplicas |
| Déploiement | `./scripts/deploy.sh dev` | CI, à chaque push sur `main` | CI, après validation en test |

## Kustomize

Les manifests communs sont dans `k8s/base/`. Chaque overlay n'exprime que ses différences :

- **dev et test** : namespace, host de l'Ingress, ServiceMonitor pour Prometheus ;
- **prod** : namespace `team3`, HTTPRoute rattachée à la gateway partagée `infra/main-gateway`, suppression des objets non autorisés sur ce cluster (Ingress, HPA, PodDisruptionBudget), 3 réplicas pour le backend.

La base de données est un **composant** Kustomize (`k8s/components/citus/`) : il ajoute les StatefulSets Citus et injecte `DATABASE_URL` dans le backend. La base peut ainsi être activée dans un overlay sans dupliquer les manifests.

Kustomize est intégré à `kubectl` et décrit les variantes sous forme de patchs sur des manifests standards, lisibles tels quels. Pour trois environnements proches, il offre la souplesse nécessaire sans la couche de templating de Helm.

## Contraintes du cluster de production

Le compte `team3` dispose de droits limités à son namespace :

| Autorisé | Non autorisé |
|---|---|
| Deployments, StatefulSets, Services, Pods, Secrets, HTTPRoutes | Jobs, HPA, PodDisruptionBudgets, ConfigMaps, PVC, `kubectl exec` |

Le pipeline en tient compte :

- l'initialisation de Citus, les migrations et l'[export pour la base de test](../refresh-test.md) s'exécutent dans des **Pods** ponctuels (`k8s/tasks/`, `restartPolicy: Never`), dont le script de déploiement suit l'état jusqu'à `Succeeded` ou `Failed` ;
- les volumes de la base sont créés par le contrôleur StatefulSet à partir des `volumeClaimTemplates` (1 Gi par pod). La politique de rétention `Retain` conserve les données même si le StatefulSet est supprimé ;
- la disponibilité pendant les mises à jour repose sur la stratégie de rolling update et sur les 3 réplicas, en l'absence de PodDisruptionBudget.

## Ressources et sondes

| Pod | Requests | Limits | Readiness | Liveness |
|---|---|---|---|---|
| backend | 50m / 96Mi | 250m / 256Mi | `GET /api/ready` | `GET /api/health` |
| frontend | 20m / 32Mi | 100m / 64Mi | `GET /healthz` | `GET /healthz` |
| redis | 20m / 32Mi | 200m / 128Mi | `redis-cli ping` | port TCP 6379 |
| citus | 100m / 256Mi | 1 CPU / 1Gi | `pg_isready` | `pg_isready` |

La sonde **readiness** détermine si un pod reçoit du trafic : le backend n'est prêt que lorsque la base répond. La sonde **liveness** détermine si le conteneur doit être redémarré : elle ne vérifie que le processus, afin qu'une panne de la base ne provoque pas de redémarrages en cascade de tous les pods backend.

## Autoscaling

En dev et en test, un HorizontalPodAutoscaler ajuste le nombre de pods backend entre 2 et 8, avec une cible de 60 % d'utilisation CPU par rapport aux requests. Le script `load-test.sh` permet d'observer la montée en charge dans Grafana.
