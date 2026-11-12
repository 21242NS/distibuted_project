# Scaling

## Vue d'ensemble

| Composant | Mode de scaling | dev / test | prod |
|---|---|---|---|
| backend | Horizontal | Automatique (HPA, 2 à 8 pods) | Manuel (3 pods) |
| frontend | Horizontal | Manuel (2 pods) | Manuel (2 pods) |
| Redis | Vertical | Limite mémoire | Limite mémoire |
| Citus | Ajout de workers et rééquilibrage | Manuel | Manuel |

Le backend et le frontend étant sans état, ils se mettent à l'échelle en ajoutant des pods, sans coordination entre eux.

## Autoscaling du backend

L'HPA (`k8s/base/backend/hpa.yaml`) maintient l'utilisation CPU moyenne autour de **60 % des requests** (50m par pod, soit environ 30m) :

| Paramètre | Valeur |
|---|---|
| `minReplicas` | 2 |
| `maxReplicas` | 8 |
| Métrique | CPU, `averageUtilization: 60` |
| Source des mesures | metrics-server |

Kubernetes ajoute des pods dès que la moyenne dépasse la cible, et n'en retire qu'après 5 minutes de charge réduite, ce qui évite les oscillations.

### Observer l'autoscaling

```bash
./scripts/load-test.sh test 3m 50
```

Dans un second terminal :

```bash
kubectl get hpa -n test -w
```

Le dashboard Grafana montre en parallèle les panneaux *Réplicas voulus par l'HPA*, *Pods backend prêts* et *CPU backend par pod*. Le script refuse de s'exécuter sur la production, le cluster de l'école étant partagé.

### Ajuster l'HPA

Modifier `minReplicas`, `maxReplicas` ou `averageUtilization` dans `k8s/base/backend/hpa.yaml`, puis redéployer. Une cible plus basse fait réagir l'HPA plus tôt, au prix de davantage de pods.

## Scaling manuel

En production, l'HPA n'est pas autorisé : le nombre de réplicas du backend est fixé dans `k8s/overlays/prod/kustomization.yaml` :

```yaml
- patch: |-
    - op: add
      path: /spec/replicas
      value: 3
  target:
    kind: Deployment
    name: backend
```

Après modification et push, la CI applique la nouvelle valeur. En cas d'urgence, une commande prend effet immédiatement, mais sera écrasée au déploiement suivant :

```bash
kubectl --context team3@cluster-sc -n team3 scale deployment/backend --replicas=5
```

Pour le frontend, la valeur se trouve dans `k8s/base/frontend/deployment.yaml`.

## Ressources par pod

Le scaling vertical se règle par les `requests` et `limits` de chaque Deployment (voir [Kubernetes](kubernetes.md#ressources-et-sondes)). Les `requests` servent au placement des pods et au calcul de l'HPA ; les `limits` plafonnent la consommation. Pour Redis, la limite du conteneur (128 Mi) doit rester supérieure à `--maxmemory` (96 Mo).

## Ajouter un worker Citus

1. Augmenter `replicas` dans `k8s/components/citus/workers.yaml` (par exemple de 2 à 3).
2. Déployer. Le StatefulSet crée `citus-worker-2` avec son volume, puis `citus-init`, qui lit le nombre de réplicas, l'enregistre auprès du coordinator.
3. Les shards existants restent sur les anciens workers. Pour les répartir, depuis le coordinator :

```sql
SELECT citus_rebalance_start();
SELECT * FROM citus_rebalance_status();
```

4. Vérifier la nouvelle répartition :

```sql
SELECT nodename, count(*) AS placements
FROM pg_dist_placement
JOIN pg_dist_node USING (groupid)
GROUP BY nodename;
```

Avec un facteur de réplication de 2, chaque shard reste présent sur deux workers après le rééquilibrage.

!!! warning "Réduire le nombre de workers"
    Diminuer `replicas` supprime le dernier worker sans déplacer ses shards. Il faut d'abord vider le nœud depuis le coordinator (`citus_drain_node`), puis le retirer (`citus_remove_node`), avant de réduire le StatefulSet.

## Accès SQL au coordinator

En local :

```bash
kubectl exec -it -n dev citus-coordinator-0 -- psql -U postgres -d photos
```

En production, `kubectl exec` n'est pas autorisé. Les opérations d'administration s'exécutent dans un Pod ponctuel, sur le modèle de `k8s/tasks/citus-init.yaml`.
