"""rag knowledge_chunks and training_examples tables

Revision ID: a1b2c3d4e5f6
Revises: c32572188fcd
Create Date: 2026-07-21 14:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'c32572188fcd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'knowledge_chunks',
        sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('role_key', sa.Text(), nullable=False),
        sa.Column('company_name', sa.Text(), nullable=True),
        sa.Column('category', sa.Text(), nullable=False),
        sa.Column('question', sa.Text(), nullable=False),
        sa.Column('ideal_answer', sa.Text(), nullable=False),
        sa.Column('keywords', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('quality_score', sa.Numeric(precision=3, scale=2), nullable=True),
        sa.Column('source', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_knowledge_chunks_role_key', 'knowledge_chunks', ['role_key'])
    op.create_index('ix_knowledge_chunks_company_name', 'knowledge_chunks', ['company_name'])

    op.create_table(
        'training_examples',
        sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('session_id', sa.UUID(as_uuid=False), nullable=True),
        sa.Column('role_key', sa.Text(), nullable=False),
        sa.Column('company_name', sa.Text(), nullable=True),
        sa.Column('question', sa.Text(), nullable=False),
        sa.Column('candidate_answer', sa.Text(), nullable=False),
        sa.Column('sub_scores', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('overall_score', sa.Integer(), nullable=True),
        sa.Column('model_answer', sa.Text(), nullable=True),
        sa.Column('is_validated', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_training_examples_role_key', 'training_examples', ['role_key'])


def downgrade() -> None:
    op.drop_index('ix_training_examples_role_key', table_name='training_examples')
    op.drop_table('training_examples')
    op.drop_index('ix_knowledge_chunks_company_name', table_name='knowledge_chunks')
    op.drop_index('ix_knowledge_chunks_role_key', table_name='knowledge_chunks')
    op.drop_table('knowledge_chunks')
