import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Integer, LargeBinary, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    # Table de référence Citus : copiée en entier sur chaque worker (petite, souvent jointe)
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    # Pour l'authentification future. Nullable (« expand ») : les utilisateurs existants n'en ont pas,
    # et l'ancienne version du code continue de fonctionner pendant le rolling update.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Photo(Base):
    # Table distribuée Citus, shardée par user_id : toutes les photos d'un utilisateur
    # sont sur le même shard, la détection de doublons reste donc locale à un worker.
    # Règle Citus : la clé de distribution (user_id) doit faire partie de la clé primaire.
    __tablename__ = "photos"

    # Pas de ForeignKey vers users : non supportée par Citus avec la réplication des shards (facteur 2)
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    # Le contenu de l'image est stocké dans la base : il est donc shardé et répliqué avec le reste.
    # deferred : pas chargé tant qu'on n'y accède pas (les listes restent légères).
    content: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
