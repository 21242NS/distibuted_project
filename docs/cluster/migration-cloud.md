# Migration vers un cluster cloud

Cette page décrit le passage du cluster local à un cluster Kubernetes distant, en prenant l'exemple du cluster OVH de l'ECAM utilisé pour la production.

## Ce qui change entre le local et le cloud

| | Local (Docker Desktop) | Cloud (OVH) |
|---|---|---|
| Accès | Contexte `docker-desktop`, administrateur | Kubeconfig fourni, droits limités au namespace `team3` |
| Images | Construites localement (dev) ou GHCR (test) | GHCR uniquement, architecture `amd64` |
| Exposition | Ingress Traefik, `*.photos.localhost` | HTTPRoute sur la gateway partagée `infra/main-gateway` |
| Stockage | StorageClass `hostpath` | StorageClass par défaut du cluster |
| Autoscaling | HPA et PodDisruptionBudget | Non autorisés : 3 réplicas fixes |
| Monitoring | kube-prometheus-stack installé par le projet | Non géré par le projet |
| Tâches ponctuelles | Pods | Pods (Jobs non autorisés) |

## 1. Configurer l'accès

Fusionner le kubeconfig reçu avec la configuration locale, sans écraser les contextes existants :

```bash
KUBECONFIG=~/.kube/config:~/Downloads/team3.yaml \
  kubectl config view --flatten > /tmp/kubeconfig
mv /tmp/kubeconfig ~/.kube/config
chmod 600 ~/.kube/config
kubectl config get-contexts
```

!!! warning "Confidentialité"
    Le kubeconfig contient une clé privée. Il ne doit jamais être versionné ni partagé.

## 2. Inventorier les droits

Sur un cluster partagé, les droits sont souvent restreints. Avant tout déploiement :

```bash
kubectl --context team3@cluster-sc -n team3 auth can-i --list
```

Chaque type d'objet du rendu Kustomize doit apparaître dans la liste avec le verbe `create`. Les objets non autorisés sont retirés dans l'overlay par des patchs `$patch: delete`. C'est ainsi que `k8s/overlays/prod` supprime l'Ingress, l'HPA et les PodDisruptionBudgets.

## 3. Adapter l'overlay

Dans `k8s/overlays/prod/` :

| Élément | Fichier | À adapter |
|---|---|---|
| Namespace | `kustomization.yaml` | `namespace: team3` |
| Exposition | `httproute.yaml` | `hostnames` et `parentRefs` (nom et namespace de la gateway) |
| Registre | `kustomization.yaml`, section `images` | `newName: ghcr.io/<compte>/photo-backend` |
| Capacité | `kustomization.yaml` | Nombre de réplicas du backend |

Pour vérifier le rendu sans rien appliquer :

```bash
kubectl kustomize k8s/overlays/prod
kubectl --context team3@cluster-sc apply --dry-run=server -k k8s/overlays/prod
```

Le dry-run côté serveur valide les droits et les schémas sans rien créer.

## 4. Déclarer l'environnement dans les scripts

Les correspondances entre environnement, contexte, namespace et URL se trouvent dans `scripts/lib.sh` (`context_for_env`, `namespace_for_env`, `url_for_env`). Pour cibler ponctuellement un autre cluster sans modifier le fichier :

```bash
KUBE_CONTEXT=mon-autre-cluster ./scripts/promote_prod.sh sha-abc1234
```

## 5. Rendre les images accessibles

Le cluster télécharge les images depuis GHCR. Deux possibilités :

- rendre les paquets `photo-backend` et `photo-frontend` publics (GitHub → Packages → Package settings → Change visibility) ;
- ou créer un Secret de type `docker-registry` et le référencer dans `imagePullSecrets`.

Les images sont construites pour `linux/amd64` et `linux/arm64` : elles tournent aussi bien sur les nœuds du cloud que sur un Mac Apple Silicon.

## 6. Vérifier le stockage

Les StatefulSets Citus demandent leurs volumes via `volumeClaimTemplates`, sans préciser de StorageClass : le cluster doit donc en proposer une par défaut. La taille demandée (1 Gi) doit être fixée **avant** le premier déploiement, car Kubernetes interdit de modifier `volumeClaimTemplates` sur un StatefulSet existant.

## 7. Premier déploiement

La production reçoit toujours une image déjà validée en test :

```bash
./scripts/promote_prod.sh sha-<commit>
```

Le script vérifie l'existence des images sur GHCR, déploie Citus et l'initialise, applique les migrations, met à jour l'application, puis exécute le smoke test sur l'URL de production.

## 8. Valider

```bash
kubectl --context team3@cluster-sc -n team3 get pods -o wide
./scripts/smoke-test.sh http://team3.laboinfo-ecam.be
./scripts/zero-downtime-check.sh prod 60
```

Une fois la validation manuelle réussie, la CI prend le relais : chaque push sur `main` validé en test est promu automatiquement (voir [Pipeline CI/CD](../pipeline.md)).
