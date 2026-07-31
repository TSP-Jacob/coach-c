from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()

STATUSES = ("pending", "in_progress", "done")


def _caller(db, agent_id: str) -> dict:
    res = db.table("agents").select("id, role, brokerage_id, name").eq("id", agent_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Agent not found")
    return res.data


class TaskCreate(BaseModel):
    assigned_to: str
    title: str
    description: str | None = None
    due_date: str | None = None  # YYYY-MM-DD


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    due_date: str | None = None
    assigned_to: str | None = None


@router.get("/")
def list_tasks(
    assigned_to: str | None = Query(None),
    status: str | None = Query(None),
    jwt_agent_id: str | None = Depends(get_jwt_agent_id),
):
    if not jwt_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    caller = _caller(db, jwt_agent_id)
    can_manage = caller["role"] in ("admin", "manager")

    q = db.table("tasks").select(
        "*, assignee:agents!tasks_assigned_to_fkey(id,name), creator:agents!tasks_created_by_fkey(id,name)"
    )
    if can_manage:
        q = q.eq("brokerage_id", caller["brokerage_id"])
        if assigned_to:
            q = q.eq("assigned_to", assigned_to)
    else:
        q = q.eq("assigned_to", jwt_agent_id)

    if status:
        q = q.eq("status", status)

    return q.order("created_at", desc=True).execute().data


@router.post("/")
def create_task(body: TaskCreate, jwt_agent_id: str | None = Depends(get_jwt_agent_id)):
    if not jwt_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    caller = _caller(db, jwt_agent_id)
    if caller["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only managers can assign tasks")

    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")

    assignee = _caller(db, body.assigned_to)
    if assignee["brokerage_id"] != caller["brokerage_id"]:
        raise HTTPException(status_code=400, detail="That person isn't in your organization")

    result = db.table("tasks").insert({
        "brokerage_id": caller["brokerage_id"],
        "assigned_to": body.assigned_to,
        "created_by": jwt_agent_id,
        "title": body.title.strip(),
        "description": (body.description or "").strip() or None,
        "due_date": body.due_date or None,
    }).execute()
    return result.data[0]


@router.patch("/{task_id}")
def update_task(task_id: str, body: TaskUpdate, jwt_agent_id: str | None = Depends(get_jwt_agent_id)):
    if not jwt_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    caller = _caller(db, jwt_agent_id)
    can_manage = caller["role"] in ("admin", "manager")

    existing = db.table("tasks").select("*").eq("id", task_id).maybe_single().execute()
    if not existing or not existing.data:
        raise HTTPException(status_code=404, detail="Task not found")
    task = existing.data

    if can_manage:
        if task["brokerage_id"] != caller["brokerage_id"]:
            raise HTTPException(status_code=403, detail="Not your organization's task")
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if "assigned_to" in updates:
            assignee = _caller(db, updates["assigned_to"])
            if assignee["brokerage_id"] != caller["brokerage_id"]:
                raise HTTPException(status_code=400, detail="That person isn't in your organization")
    else:
        if task["assigned_to"] != jwt_agent_id:
            raise HTTPException(status_code=403, detail="Not your task")
        if body.status is None:
            raise HTTPException(status_code=403, detail="You can only update the status of your own tasks")
        updates = {"status": body.status}

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    if "status" in updates:
        if updates["status"] not in STATUSES:
            raise HTTPException(status_code=400, detail=f"status must be one of {STATUSES}")
        updates["completed_at"] = datetime.now(timezone.utc).isoformat() if updates["status"] == "done" else None

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = db.table("tasks").update(updates).eq("id", task_id).execute()
    return result.data[0]


@router.delete("/{task_id}")
def delete_task(task_id: str, jwt_agent_id: str | None = Depends(get_jwt_agent_id)):
    if not jwt_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    caller = _caller(db, jwt_agent_id)
    if caller["role"] not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only managers can delete tasks")

    existing = db.table("tasks").select("brokerage_id").eq("id", task_id).maybe_single().execute()
    if not existing or not existing.data:
        raise HTTPException(status_code=404, detail="Task not found")
    if existing.data["brokerage_id"] != caller["brokerage_id"]:
        raise HTTPException(status_code=403, detail="Not your organization's task")

    db.table("tasks").delete().eq("id", task_id).execute()
    return {"deleted": True}
