"""Schéma initial : utilisateurs et photos, distribués avec Citus

Revision ID: 0001
Revises:
Create Date: 2026-10-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _is_citus() -> bool:
    return bool(op.get_bind().execute(sa.text("SELECT 1 FROM pg_extension WHERE extname = 'citus'")).scalar())


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
    )
    op.create_table(
        "photos",
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("id", sa.Uuid, nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("size", sa.BigInteger, nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("content", sa.LargeBinary, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("user_id", "id"),
    )
    op.create_index("ix_photos_user_sha256", "photos", ["user_id", "sha256"])

    if _is_citus():
        op.execute("SELECT create_reference_table('users')")
        op.execute("SELECT create_distributed_table('photos', 'user_id')")

    op.execute("INSERT INTO users (id, email, name) VALUES (1, 'demo@photos.local', 'Utilisateur démo')")


def downgrade() -> None:
    op.drop_table("photos")
    op.drop_table("users")
