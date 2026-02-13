"""
API endpoints for execution history management.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
import time

from ..database import get_db
from ..models import ExecutionHistory
from ..middleware.auth import get_current_user

router = APIRouter(prefix="/api/execution-history", tags=["Execution History"])


class ExecutionHistoryCreate(BaseModel):
    """Schema for creating execution history entries."""
    execution_type: str  # 'command', 'task', or 'plan'
    node_name: str
    command_name: Optional[str] = None
    task_name: Optional[str] = None
    plan_name: Optional[str] = None
    environment: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None
    result_format: Optional[str] = None
    status: str = "running"
    error_message: Optional[str] = None
    result_preview: Optional[str] = None
    duration_ms: Optional[int] = None


class ExecutionHistoryUpdate(BaseModel):
    """Schema for updating execution history entries."""
    status: str
    duration_ms: Optional[int] = None
    error_message: Optional[str] = None
    result_preview: Optional[str] = None


class ExecutionHistoryResponse(BaseModel):
    """Response schema for execution history."""
    id: int
    execution_type: str
    node_name: str
    command_name: Optional[str]
    task_name: Optional[str]
    plan_name: Optional[str]
    environment: Optional[str]
    parameters: Optional[Dict[str, Any]]
    result_format: Optional[str]
    status: str
    executed_at: datetime
    executed_by: str
    duration_ms: Optional[int]
    error_message: Optional[str]
    result_preview: Optional[str]
    
    class Config:
        from_attributes = True


@router.post("/", response_model=ExecutionHistoryResponse)
async def create_execution_history(
    entry: ExecutionHistoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(get_current_user)
):
    """Create a new execution history entry."""
    # Create new entry
    new_entry = ExecutionHistory(
        execution_type=entry.execution_type,
        node_name=entry.node_name,
        command_name=entry.command_name,
        task_name=entry.task_name,
        plan_name=entry.plan_name,
        environment=entry.environment,
        parameters=entry.parameters,
        result_format=entry.result_format,
        status=entry.status,
        executed_by=current_user,
        duration_ms=entry.duration_ms,
        error_message=entry.error_message,
        result_preview=entry.result_preview[:500] if entry.result_preview else None
    )
    
    db.add(new_entry)
    await db.commit()
    await db.refresh(new_entry)
    
    return new_entry


@router.patch("/{history_id}", response_model=ExecutionHistoryResponse)
async def update_execution_history(
    history_id: int,
    update: ExecutionHistoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(get_current_user)
):
    """Update an existing execution history entry."""
    # Get the entry
    result = await db.execute(
        select(ExecutionHistory).where(ExecutionHistory.id == history_id)
    )
    entry = result.scalar_one_or_none()
    
    if not entry:
        raise HTTPException(status_code=404, detail="Execution history entry not found")
    
    # Update fields
    entry.status = update.status
    if update.duration_ms is not None:
        entry.duration_ms = update.duration_ms
    if update.error_message is not None:
        entry.error_message = update.error_message
    if update.result_preview is not None:
        entry.result_preview = update.result_preview[:500]
    
    await db.commit()
    await db.refresh(entry)
    
    return entry


@router.get("/", response_model=List[ExecutionHistoryResponse])
async def get_execution_history(
    days: int = Query(14, ge=1, le=90, description="Number of days of history to retrieve"),
    execution_type: Optional[str] = Query(None, description="Filter by execution type"),
    node_name: Optional[str] = Query(None, description="Filter by node name"),
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(500, ge=1, le=1000, description="Maximum number of entries to return"),
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(get_current_user)
):
    """Get execution history for the last N days."""
    # Calculate cutoff date
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Build query
    query = select(ExecutionHistory).where(
        ExecutionHistory.executed_at >= cutoff_date
    )
    
    # Apply filters
    if execution_type:
        query = query.where(ExecutionHistory.execution_type == execution_type)
    if node_name:
        query = query.where(ExecutionHistory.node_name == node_name)
    if status:
        query = query.where(ExecutionHistory.status == status)
    
    # Order by most recent first and apply limit
    query = query.order_by(desc(ExecutionHistory.executed_at)).limit(limit)
    
    # Execute query
    result = await db.execute(query)
    entries = result.scalars().all()
    
    return entries


@router.get("/stats")
async def get_execution_stats(
    days: int = Query(14, ge=1, le=90, description="Number of days to calculate stats for"),
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(get_current_user)
):
    """Get execution statistics for the last N days."""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Get all entries in the date range
    result = await db.execute(
        select(ExecutionHistory).where(
            ExecutionHistory.executed_at >= cutoff_date
        )
    )
    entries = result.scalars().all()
    
    # Calculate statistics
    total_executions = len(entries)
    successful = sum(1 for e in entries if e.status == 'success')
    failed = sum(1 for e in entries if e.status == 'failure')
    running = sum(1 for e in entries if e.status == 'running')
    
    # Group by type
    by_type = {
        'command': sum(1 for e in entries if e.execution_type == 'command'),
        'task': sum(1 for e in entries if e.execution_type == 'task'),
        'plan': sum(1 for e in entries if e.execution_type == 'plan')
    }
    
    # Most active nodes
    node_counts = {}
    for entry in entries:
        node_counts[entry.node_name] = node_counts.get(entry.node_name, 0) + 1
    top_nodes = sorted(node_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    
    # Average duration
    durations = [e.duration_ms for e in entries if e.duration_ms is not None]
    avg_duration = sum(durations) / len(durations) if durations else 0
    
    return {
        "period_days": days,
        "total_executions": total_executions,
        "successful": successful,
        "failed": failed,
        "running": running,
        "by_type": by_type,
        "top_nodes": [{"node": node, "count": count} for node, count in top_nodes],
        "avg_duration_ms": avg_duration
    }


@router.delete("/{history_id}")
async def delete_execution_history(
    history_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(get_current_user)
):
    """Delete a specific execution history entry."""
    result = await db.execute(
        select(ExecutionHistory).where(ExecutionHistory.id == history_id)
    )
    entry = result.scalar_one_or_none()
    
    if not entry:
        raise HTTPException(status_code=404, detail="Execution history entry not found")
    
    await db.delete(entry)
    await db.commit()
    
    return {"message": "Execution history entry deleted"}


@router.delete("/cleanup/old")
async def cleanup_old_history(
    days: int = Query(90, ge=30, le=365, description="Delete entries older than N days"),
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(get_current_user)
):
    """Delete execution history entries older than N days."""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Count entries to be deleted
    count_result = await db.execute(
        select(ExecutionHistory).where(
            ExecutionHistory.executed_at < cutoff_date
        )
    )
    count = len(count_result.scalars().all())
    
    # Delete old entries
    await db.execute(
        ExecutionHistory.__table__.delete().where(
            ExecutionHistory.executed_at < cutoff_date
        )
    )
    await db.commit()
    
    return {
        "message": f"Deleted {count} execution history entries older than {days} days"
    }