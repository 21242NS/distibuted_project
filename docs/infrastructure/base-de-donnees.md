# Base de données Citus

## Topologie

Citus est une extension de PostgreSQL qui répartit les tables sur plusieurs nœuds tout en conservant une interface SQL standard :

- le **coordinator** (`citus-coordinator-0`) reçoit les requêtes du backend, détermine les shards concernés et les transmet aux workers ;
- les **workers** (`citus-worker-0`, `citus-worker-1`) stockent les shards et exécutent les requêtes.

Chaque nœud est un pod de StatefulSet avec son propre volume persistant de 1 Gi. Le StatefulSet fournit à chaque pod un nom DNS stable (`citus-worker-0.citus-workers`), indispensable puisque le coordinator référence les workers par leur nom.

## Sharding

| Table | Type | Clé de distribution |
|---|---|---|
| `users` | Table de référence, copiée intégralement sur chaque worker | – |
| `photos` | Distribuée | `user_id` |
| `sessions` | Distribuée | `token_hash` |

Toutes les requêtes sur les photos filtrent sur `user_id` : Citus les route vers **un seul shard**, sans requête dispersée sur l'ensemble des workers. Distribuer par `id` répartirait les photos d'un même utilisateur sur tous les shards, et chaque affichage de bibliothèque devrait alors interroger tous les workers.

Les sessions sont distribuées par `token_hash`, car elles sont toujours recherchées par cette empreinte. La table `users`, petite et souvent jointe, est une table de référence : les jointures restent locales à chaque worker.

## Réplication

L'initialisation règle `citus.shard_replication_factor = 2` : chaque shard est stocké sur les deux workers. Si un worker devient indisponible, les lectures sont servies par la copie restante. À son retour, le worker retrouve ses données sur son volume persistant.

Le coordinator reste un point unique de défaillance : il détient les métadonnées du cluster, et son indisponibilité interrompt l'accès à la base jusqu'à son redémarrage. Son volume persistant garantit qu'aucune donnée n'est perdue.

## Initialisation

Le Pod `citus-init` (`k8s/tasks/citus-init.yaml`) s'exécute après le démarrage des StatefulSets et avant les migrations :

1. attente de la disponibilité du coordinator et de chaque worker ;
2. enregistrement du coordinator (`citus_set_coordinator_host`) ;
3. enregistrement de chaque worker (`citus_add_node`) ;
4. réglage du facteur de réplication, puis rechargement de la configuration.

Ces opérations sont idempotentes : les exécuter à nouveau sur un cluster déjà initialisé n'a aucun effet.

Après une initialisation réussie, le script de déploiement enregistre le nombre de workers dans l'annotation `photos.team3/citus-initialized-workers` du StatefulSet `citus-worker`. Aux déploiements suivants, la tâche n'est relancée que si ce nombre a changé. On évite ainsi de demander un pod supplémentaire au cluster à chaque mise à jour, ce qui compte sur un cluster partagé dont la mémoire est limitée. Pour forcer une nouvelle initialisation :

```bash
FORCE_CITUS_INIT=1 ./scripts/deploy.sh dev
```

## Vérification

Depuis le coordinator :

```sql
SELECT * FROM citus_get_active_worker_nodes();

SHOW citus.shard_replication_factor;

SELECT logicalrelid, count(*) AS shards
FROM pg_dist_shard
GROUP BY logicalrelid;

SELECT s.logicalrelid, p.shardid, n.nodename
FROM pg_dist_placement p
JOIN pg_dist_node n USING (groupid)
JOIN pg_dist_shard s USING (shardid)
ORDER BY p.shardid
LIMIT 10;
```

## Stockage

Les photos sont stockées dans la base, à raison de 10 Mo au maximum par fichier. Avec la réplication, chaque worker détient une copie de toutes les données : la capacité utile est donc de 1 Gi au total. Sur le cluster de production, la taille des volumes ne peut pas être modifiée avec les droits du compte `team3`.
