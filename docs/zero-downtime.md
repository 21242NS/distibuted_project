# Zéro downtime

L'objectif est qu'un utilisateur ne remarque jamais un déploiement : aucune requête ne doit échouer pendant la mise à jour.

## Mécanismes

| Mécanisme | Portée | Effet |
|---|---|---|
| `maxUnavailable: 0`, `maxSurge: 1` | Deployments | Un nouveau pod démarre avant l'arrêt d'un ancien |
| Readiness probe | backend, frontend | Un pod ne reçoit du trafic qu'une fois prêt |
| `preStop: sleep 10` | backend, frontend | Le pod continue de servir le temps d'être retiré des endpoints |
| `terminationGracePeriodSeconds: 45` | backend, frontend | Les requêtes en cours se terminent avant l'arrêt |
| Plusieurs réplicas | backend, frontend | Une capacité de service est toujours disponible |
| PodDisruptionBudget `minAvailable: 1` | dev, test | Au moins un pod reste disponible pendant une maintenance de nœud |
| Sessions en base | backend | N'importe quel pod sert n'importe quel utilisateur |
| Migrations expand / contract | base de données | L'ancien et le nouveau code fonctionnent sur le même schéma |

## Déroulement d'un rolling update

Pour le backend en production (3 réplicas) :

1. Kubernetes crée un pod avec la nouvelle image : 4 pods existent, dont 3 servent le trafic.
2. Le nouveau pod démarre. Dès que `/api/ready` répond, il est ajouté aux endpoints du Service.
3. Un ancien pod passe à l'état *Terminating* : il est retiré des endpoints, mais le `preStop` le maintient actif 10 secondes, le temps que la gateway et les autres composants prennent en compte le retrait.
4. Le processus reçoit `SIGTERM`, termine les requêtes en cours puis s'arrête.
5. L'opération se répète jusqu'au remplacement de tous les pods.

À aucun moment le nombre de pods prêts ne descend sous 3.

## Vérification

```bash
./scripts/zero-downtime-check.sh prod
```

Le script interroge `/` et `/api/health` en continu et affiche toute réponse différente de `200`. Lancé pendant un déploiement, il doit terminer par :

```text
[ OK ] N requêtes, 0 erreur : aucune interruption de service
```
