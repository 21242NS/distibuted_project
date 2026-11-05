"""Sessions de connexion : empreinte du jeton, utilisateur, expiration

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def _is_citus() -> bool:
    return bool(op.get_bind().execute(sa.text("SELECT 1 FROM pg_extension WHERE extname = 'citus'")).scalar())


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])

    if _is_citus():
        op.execute("SELECT create_distributed_table('sessions', 'token_hash')")


def downgrade() -> None:
    op.drop_table("sessions")
