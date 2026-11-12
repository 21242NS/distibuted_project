# Authentification et sessions

## Mots de passe

Les mots de passe sont hachés avec **Argon2id**, l'algorithme recommandé par l'OWASP. Le calcul du hash, volontairement coûteux, s'exécute dans un pool de threads dédié afin de ne pas bloquer le traitement des autres requêtes.

## Sessions

1. À la connexion (ou à l'inscription), le serveur génère un jeton aléatoire.
2. Le jeton est envoyé au navigateur dans un cookie `session` `HttpOnly`, donc inaccessible au JavaScript de la page.
3. La table `sessions` ne conserve que l'**empreinte SHA-256** du jeton : une fuite de la base ne permet pas d'usurper une session.
4. Une session expire au bout de 24 heures (`SESSION_TTL_HOURS`). La déconnexion la supprime immédiatement.

À chaque requête authentifiée, la dépendance FastAPI `require_user` vérifie la session, d'abord dans Redis, puis dans la base.

## Pourquoi des sessions en base plutôt qu'un JWT

Une session en base peut être révoquée instantanément : la déconnexion la rend inutilisable sur tous les pods. Un JWT reste valide jusqu'à son expiration, sauf à maintenir une liste de révocation, ce qui revient à réintroduire un état partagé. Le coût d'une lecture en base à chaque requête est absorbé par le [cache Redis](../infrastructure/cache.md).

## Haute disponibilité

Comme les sessions ne sont pas stockées dans la mémoire d'un pod, l'utilisateur n'est pas lié à un pod particulier : un rolling update ou une mise à l'échelle ne déconnecte personne.
