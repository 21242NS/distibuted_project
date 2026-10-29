"""Ajoute users.password_hash (préparation de l'authentification)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-29

Migration « expand » : la colonne est nullable, donc compatible avec l'ancienne version
du code pendant le rolling update. Elle pourra devenir NOT NULL (« contract ») quand
tous les utilisateurs auront un mot de passe.
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # users est une table de référence Citus : la colonne est ajoutée sur toutes les copies
    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "password_hash")
