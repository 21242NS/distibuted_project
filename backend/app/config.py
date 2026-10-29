import os

# URL de la base, injectée par Kubernetes (k8s/components/citus/backend-db-patch.yaml).
# Absente en local et dans les tests unitaires : l'app démarre alors sans base de données.
DATABASE_URL = os.getenv("DATABASE_URL")
