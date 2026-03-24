"""
Database Models Package

This package contains SQLAlchemy ORM models and Pydantic schemas for data
validation and serialization.

**SQLAlchemy Models:**
- user.py - User accounts with roles, authentication sources, passwords
- session.py - Active user sessions for tracking logged-in users
- enc.py - External Node Classifier (ENC) hierarchical data model
- execution_history.py - Bolt command/task/plan execution history

**Pydantic Schemas:**
- schemas.py - Request/response models for API endpoints

**Design Notes:**
- Models use SQLAlchemy 2.0 async style with Mapped[] annotations
- Schemas use Pydantic v2 with Field validators
- All models have created_at/updated_at timestamps where appropriate
- Passwords are never stored in plain text (bcrypt hashing)
"""

from .user import User
from .session import ActiveSession
from .enc import NodeGroup, NodeClassification, ClassificationRule
from .execution_history import ExecutionHistory
