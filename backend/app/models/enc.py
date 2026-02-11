"""
Database models for the Hierarchical External Node Classifier.

Hierarchy (lowest → highest priority):
  Common → Environment → Group → Node

Each layer can define classes and parameters. When Puppet queries
the ENC for a node, all applicable layers are deep-merged with
higher-priority layers overriding lower ones.
"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Table, JSON
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from ..database import Base


# ─── Association tables ─────────────────────────────────────

node_group_membership = Table(
    "node_group_membership",
    Base.metadata,
    Column("node_certname", String(255), ForeignKey("enc_nodes.certname"), primary_key=True),
    Column("group_id", Integer, ForeignKey("enc_groups.id"), primary_key=True),
)


# ─── Layer 1: Common (global defaults) ─────────────────────

class EncCommon(Base):
    """Global defaults applied to every node. Singleton row (id=1)."""
    __tablename__ = "enc_common"

    id = Column(Integer, primary_key=True, default=1)
    classes = Column(JSON, default=dict)
    parameters = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


# ─── Layer 2: Environment ──────────────────────────────────

class EncEnvironment(Base):
    """Environment-level classification (production, staging, etc.)."""
    __tablename__ = "enc_environments"

    name = Column(String(255), primary_key=True)
    description = Column(Text, default="")
    classes = Column(JSON, default=dict)
    parameters = Column(JSON, default=dict)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    # Back-references
    groups = relationship("EncGroup", back_populates="environment_obj")
    nodes = relationship("EncNode", back_populates="environment_obj")


# ─── Layer 3: Node Group ──────────────────────────────────

class EncGroup(Base):
    """Logical grouping (webservers, databases, etc.) within an environment."""
    __tablename__ = "enc_groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    description = Column(Text, default="")
    environment = Column(String(255), ForeignKey("enc_environments.name"), nullable=False)
    classes = Column(JSON, default=dict)
    parameters = Column(JSON, default=dict)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    environment_obj = relationship("EncEnvironment", back_populates="groups")
    nodes = relationship("EncNode", secondary=node_group_membership,
                         back_populates="groups", lazy="selectin")


# ─── Layer 4: Node ─────────────────────────────────────────

class EncNode(Base):
    """Per-node classification — the 'container' that inherits from the hierarchy."""
    __tablename__ = "enc_nodes"

    certname = Column(String(255), primary_key=True)
    environment = Column(String(255), ForeignKey("enc_environments.name"), nullable=False)
    classes = Column(JSON, default=dict)       # node-specific overrides
    parameters = Column(JSON, default=dict)    # node-specific parameters
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    environment_obj = relationship("EncEnvironment", back_populates="nodes")
    groups = relationship("EncGroup", secondary=node_group_membership,
                          back_populates="nodes", lazy="selectin")


# ─── Legacy tables (kept for migration compatibility) ──────

class NodeGroup(Base):
    """Legacy: kept so old tables don't cause errors."""
    __tablename__ = "node_groups"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    description = Column(Text, default="")
    environment = Column(String(255), default="production")
    parent_group_id = Column(Integer, ForeignKey("node_groups.id"), nullable=True)
    classes = Column(JSON, default=dict)
    parameters = Column(JSON, default=dict)
    rule = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    parent = relationship("NodeGroup", remote_side=[id], backref="children")


class NodeClassification(Base):
    """Legacy: kept so old tables don't cause errors."""
    __tablename__ = "node_classifications"
    certname = Column(String(255), primary_key=True)
    environment = Column(String(255), default="production")
    classes = Column(JSON, default=dict)
    parameters = Column(JSON, default=dict)
    is_pinned = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ClassificationRule(Base):
    """Legacy: kept so old tables don't cause errors."""
    __tablename__ = "classification_rules"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), unique=True, nullable=False)
    description = Column(Text, default="")
    priority = Column(Integer, default=0)
    fact_match = Column(JSON, nullable=False)
    group_id = Column(Integer, nullable=False)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
