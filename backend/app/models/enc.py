"""
Database models for the External Node Classifier.
"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Table, JSON
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from ..database import Base


# Many-to-many: groups <-> classes
group_classes = Table(
    "group_classes",
    Base.metadata,
    Column("group_id", Integer, ForeignKey("node_groups.id"), primary_key=True),
    Column("class_name", String(255), primary_key=True),
)

# Many-to-many: nodes <-> groups
node_group_membership = Table(
    "node_group_membership",
    Base.metadata,
    Column("node_certname", String(255), ForeignKey("node_classifications.certname"), primary_key=True),
    Column("group_id", Integer, ForeignKey("node_groups.id"), primary_key=True),
)


class NodeGroup(Base):
    """A group of nodes that share classes and parameters."""
    __tablename__ = "node_groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), unique=True, nullable=False, index=True)
    description = Column(Text, default="")
    environment = Column(String(255), default="production")
    parent_group_id = Column(Integer, ForeignKey("node_groups.id"), nullable=True)
    classes = Column(JSON, default=dict)  # {"class_name": {param: value}}
    parameters = Column(JSON, default=dict)  # top-level parameters
    rule = Column(Text, nullable=True)  # Match rule (fact-based), JSON string
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    parent = relationship("NodeGroup", remote_side=[id], backref="children")
    nodes = relationship("NodeClassification", secondary=node_group_membership,
                         back_populates="groups")


class NodeClassification(Base):
    """Individual node classification (ENC data)."""
    __tablename__ = "node_classifications"

    certname = Column(String(255), primary_key=True)
    environment = Column(String(255), default="production")
    classes = Column(JSON, default=dict)  # {"class_name": {param: value}}
    parameters = Column(JSON, default=dict)  # top-level parameters
    is_pinned = Column(Boolean, default=False)  # manually pinned vs rule-matched
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    groups = relationship("NodeGroup", secondary=node_group_membership,
                          back_populates="nodes")


class ClassificationRule(Base):
    """Rules for automatic node classification based on facts."""
    __tablename__ = "classification_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), unique=True, nullable=False)
    description = Column(Text, default="")
    priority = Column(Integer, default=0)  # higher = evaluated first
    fact_match = Column(JSON, nullable=False)  # e.g. {"os.family": "RedHat"}
    group_id = Column(Integer, ForeignKey("node_groups.id"), nullable=False)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    group = relationship("NodeGroup")
