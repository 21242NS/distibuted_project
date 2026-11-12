# Cache Redis

## Principe

Redis est un cache **partagé par tous les pods backend**. Un cache en mémoire propre à chaque pod ne permettrait pas une invalidation cohérente : lorsqu'un pod supprime une photo, l'entrée correspondante doit disparaître pour tous.

Le backend applique la stratégie *cache-aside* : il lit d'abord dans Redis ; si la donnée est absente, il la lit dans Citus puis l'écrit dans le cache. Chaque écriture en base supprime les entrées concernées.

## Données mises en cache

| Donnée | Clé | Durée | Invalidation |
|---|---|---|---|
| Session | `session:<empreinte du jeton>` | 120 s, sans jamais dépasser l'expiration de la session | Déconnexion |
| Liste des photos, utilisée aussi pour les doublons | `photos:<user_id>` | 5 min | Import, suppression |
| Contenu d'une image de 2 Mo au plus | `photo:<user_id>:<id>` | 10 min | Suppression |

Le jeton de session n'apparaît jamais en clair dans Redis : la clé reprend son empreinte SHA-256, comme en base.

| Variable d'environnement | Défaut |
|---|---|
| `REDIS_URL` | `redis://redis:6379/0` (cache désactivé si absente) |
| `SESSION_CACHE_SECONDS` | `120` |
| `PHOTO_LIST_CACHE_SECONDS` | `300` |
| `PHOTO_CONTENT_CACHE_SECONDS` | `600` |
| `PHOTO_CONTENT_CACHE_MAX_BYTES` | `2097152` |

## Déploiement

- Image `redis:7.4-alpine`, épinglée par digest
- Mémoire limitée à 96 Mo avec la politique `allkeys-lru` : au-delà, Redis évince les entrées les moins récemment utilisées
- Persistance désactivée (`--save "" --appendonly no`) : le cache peut toujours être reconstruit à partir de la base
- Exécution sans droits root, système de fichiers racine en lecture seule

## Résistance aux pannes

Le cache est une optimisation, jamais une dépendance :

- les opérations Redis ont un délai maximal de 0,25 s ;
- après une erreur, le backend ignore Redis pendant 5 s et lit directement la base, ce qui évite de payer ce délai à chaque requête ;
- `/api/ready` signale `"cache": "unavailable"` sans retirer le pod du trafic ;
- le cache reprend automatiquement dès que Redis répond à nouveau.

Test réalisé en dev, avec Redis arrêté pendant l'utilisation du site : toutes les requêtes ont abouti, la première en 0,27 s et les suivantes en 5 ms environ.

## Performances

Mesures en dev avec `hey`, 3 000 requêtes et 20 connexions simultanées :

| Route | Avec Redis | Sans Redis |
|---|---|---|
| `/api/me` | 213 req/s · p95 108 ms | 156 req/s · p95 380 ms |
| `/api/photos` | 363 req/s · p95 169 ms | 173 req/s · p95 367 ms |
| Contenu d'une image | 200 req/s · p95 193 ms | 216 req/s · p95 287 ms |

Le cache double le débit de la liste des photos et divise par trois la latence p95 de la vérification de session. Pour le contenu des images, le débit est limité par le transfert des données, mais la latence p95 diminue. Ces chiffres sont indicatifs : le CPU du backend est limité à 250m par pod et l'HPA peut ajouter des pods pendant la mesure.

## Limite connue

Si Redis est indisponible au moment précis d'une invalidation, l'entrée concernée subsiste jusqu'à l'expiration de sa durée de vie : au plus 2 minutes pour une session après une déconnexion, 10 minutes pour une image supprimée. Ces durées courtes ont été choisies pour borner ce risque.
