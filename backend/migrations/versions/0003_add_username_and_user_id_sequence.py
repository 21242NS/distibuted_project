"""Inscription : users.username, id générés par une séquence, email et name facultatifs

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(20), nullable=True))
    op.create_unique_constraint("uq_users_username", "users", ["username"])
    op.alter_column("users", "email", existing_type=sa.String(255), nullable=True)
    op.alter_column("users", "name", existing_type=sa.String(100), nullable=True)

    next_id = op.get_bind().execute(sa.text("SELECT COALESCE(MAX(id), 0) + 1 FROM users")).scalar()
    op.execute(f"CREATE SEQUENCE users_id_seq START WITH {int(next_id)}")
    op.execute("ALTER TABLE users ALTER COLUMN id SET DEFAULT nextval('users_id_seq')")

    op.execute("UPDATE users SET username = 'demo' WHERE id = 1 AND username IS NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE users ALTER COLUMN id DROP DEFAULT")
    op.execute("DROP SEQUENCE users_id_seq")
    op.alter_column("users", "name", existing_type=sa.String(100), nullable=False)
    op.alter_column("users", "email", existing_type=sa.String(255), nullable=False)
    op.drop_constraint("uq_users_username", "users", type_="unique")
    op.drop_column("users", "username")
