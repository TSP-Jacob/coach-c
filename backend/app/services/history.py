"""Shared assistant conversation history (voice + text).

Both the voice assistant (routers/voice.py) and the text chat (routers/chat.py)
persist their turns to the single `chat_messages` table, keyed only on
`agent_id` — one rolling history per agent that survives logout/login.

Storage is bounded by a hybrid retention policy so history stays useful without
growing unbounded: anything older than RETENTION_DAYS is dropped, and no more
than MAX_MESSAGES rows are kept per agent (whichever bites first). The per-turn
source ('voice' | 'text') is stored in the existing `context` jsonb column, so
no schema migration is required.
"""
from datetime import datetime, timezone, timedelta

# Retention policy — keep recent history, forget older (see module docstring).
RETENTION_DAYS = 30
MAX_MESSAGES = 100


def save_messages(db, agent_id: str, messages: list[dict]) -> None:
    """Insert messages then prune to keep storage bounded.

    messages: list of {"role": "user"|"assistant", "content": str,
                       "source": "voice"|"text" (optional)}.
    Empty-content messages are skipped.
    """
    rows = [
        {
            "agent_id": agent_id,
            "role": m["role"],
            "content": m["content"],
            "context": {"source": m["source"]} if m.get("source") else None,
        }
        for m in messages
        if m.get("content")
    ]
    if not rows:
        return
    db.table("chat_messages").insert(rows).execute()
    prune_history(db, agent_id)


def prune_history(db, agent_id: str) -> None:
    """Enforce the hybrid cap for one agent: drop old rows, then cap the count."""
    # Time-based: anything older than the retention window.
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
    db.table("chat_messages").delete().eq("agent_id", agent_id).lt("created_at", cutoff).execute()

    # Count-based: find the timestamp of the MAX_MESSAGES-th newest row; delete
    # everything strictly older. (Ties at the boundary may leave slightly more
    # than MAX_MESSAGES — an acceptable approximation.)
    boundary_rows = (
        db.table("chat_messages")
        .select("created_at")
        .eq("agent_id", agent_id)
        .order("created_at", desc=True)
        .range(MAX_MESSAGES - 1, MAX_MESSAGES - 1)
        .execute()
        .data
    )
    if boundary_rows:
        boundary = boundary_rows[0]["created_at"]
        db.table("chat_messages").delete().eq("agent_id", agent_id).lt("created_at", boundary).execute()


def load_recent(db, agent_id: str, limit: int = MAX_MESSAGES) -> list[dict]:
    """Return the agent's recent history in chronological order (oldest first)."""
    rows = (
        db.table("chat_messages")
        .select("role, content, created_at")
        .eq("agent_id", agent_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )
    rows.reverse()
    return rows
