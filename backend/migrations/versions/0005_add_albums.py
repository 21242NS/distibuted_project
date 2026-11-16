"""Albums : plusieurs collections de photos par utilisateur

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def _is_citus() -> bool:
    """tell if the Citus extension is installed"""
    return bool(op.get_bind().execute(sa.text("SELECT 1 FROM pg_extension WHERE extname = 'citus'")).scalar())


def upgrade() -> None:
    """create the albums and album_photos tables"""
    op.create_table(
        "albums",
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("id", sa.Uuid, nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("user_id", "id"),
        sa.UniqueConstraint("user_id", "name", name="uq_albums_user_name"),
    )
    op.create_table(
        "album_photos",
        sa.Column("user_id", sa.Integer, nullable=False),
        sa.Column("album_id", sa.Uuid, nullable=False),
        sa.Column("photo_id", sa.Uuid, nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("user_id", "album_id", "photo_id"),
    )
    op.create_index("ix_album_photos_user_photo", "album_photos", ["user_id", "photo_id"])

    if _is_citus():
        # colocated with photos so album queries stay on a single shard
        op.execute("SELECT create_distributed_table('albums', 'user_id', colocate_with => 'photos')")
        op.execute("SELECT create_distributed_table('album_photos', 'user_id', colocate_with => 'photos')")


def downgrade() -> None:
    """drop the albums and album_photos tables"""
    op.drop_table("album_photos")
    op.drop_table("albums")
