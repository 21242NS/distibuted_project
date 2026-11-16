# API

Toutes les routes sont préfixées par `/api`. Les corps de requête et de réponse sont en JSON, sauf pour l'import et le contenu des photos. Les routes photos exigent une session valide ; à défaut, elles répondent `401`.

## Santé

| Méthode | Route | Réponse |
|---|---|---|
| GET | `/health` | `200 {"status": "ok"}` tant que le processus répond (sonde liveness) |
| GET | `/ready` | `200 {"status": "ready", "cache": "ok"}` si la base répond, `503` sinon (sonde readiness) |
| GET | `/metrics` | Métriques au format Prometheus |

Le champ `cache` de `/ready` vaut `ok`, `unavailable` ou `disabled`. Une panne de Redis n'empêche pas le pod d'être prêt.

## Comptes

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| POST | `/signup` | `{"username", "password"}` | Crée le compte et ouvre la session |
| POST | `/login` | `{"username", "password"}` | Ouvre la session |
| POST | `/logout` | – | Ferme la session |
| GET | `/me` | – | `{"username"}` de l'utilisateur connecté |

## Photos

| Méthode | Route | Description | Codes |
|---|---|---|---|
| GET | `/photos` | Photos de l'utilisateur, des plus récentes aux plus anciennes | 200 |
| POST | `/photos` | Import d'un fichier (`multipart/form-data`, champ `file`) | 201, 400, 413, 415 |
| GET | `/photos/duplicates` | Groupes de photos identiques, l'original en premier | 200 |
| GET | `/photos/{id}/content` | Contenu binaire de l'image | 200, 404 |
| DELETE | `/photos/{id}` | Suppression | 204, 404 |

À l'import, le serveur calcule l'empreinte SHA-256 du fichier. Si l'utilisateur possède déjà une photo identique, la réponse l'indique par `"duplicate": true`. Les erreurs possibles sont `413` (fichier de plus de 10 Mo), `415` (type non pris en charge) et `400` (fichier vide).

Une photo appartenant à un autre utilisateur renvoie `404`, comme une photo inexistante.

## Albums

Un album regroupe des photos de la bibliothèque. Une photo peut appartenir à plusieurs albums. Supprimer un album ne supprime pas ses photos ; supprimer une photo la retire de tous ses albums.

| Méthode | Route | Corps | Description | Codes |
|---|---|---|---|---|
| GET | `/albums` | – | Albums de l'utilisateur, avec nombre de photos et couverture (dernière photo ajoutée) | 200 |
| POST | `/albums` | `{"name"}` | Création | 201, 409, 422 |
| PATCH | `/albums/{id}` | `{"name"}` | Renommage | 200, 404, 409, 422 |
| DELETE | `/albums/{id}` | – | Suppression de l'album ; les photos sont conservées | 204, 404 |
| GET | `/albums/{id}/photos` | – | Photos de l'album, des plus récentes aux plus anciennes | 200, 404 |
| POST | `/albums/{id}/photos` | `{"photo_ids": [...]}` | Ajout ; les photos déjà présentes sont ignorées | 200, 404, 422 |
| DELETE | `/albums/{id}/photos` | `{"photo_ids": [...]}` | Retrait de l'album, sans supprimer les photos | 200, 404, 422 |

Le nom d'un album compte de 1 à 60 caractères, espaces superflus retirés, et doit être unique pour un utilisateur (`409` sinon). Les ajouts et retraits portent sur 500 photos au plus par requête. Un album ou une photo appartenant à un autre utilisateur renvoie `404`.

## Exemple

```bash
API=http://team3.laboinfo-ecam.be/api

curl -c cookies -H 'Content-Type: application/json' \
     -d '{"username":"alice","password":"Password123"}' $API/signup

curl -b cookies -F file=@vacances.jpg $API/photos

curl -b cookies $API/photos
```
