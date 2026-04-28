"""
Seeds default guidelines and demo brokerage/agent into the DB on first startup.
Safe to run multiple times — skips records that already exist.
"""
import json
from pathlib import Path
from app.database import get_supabase

_GUIDELINES_DIR       = Path(__file__).parent.parent / "prompts" / "guidelines"
_DEFAULT_BROKERAGE_ID = "00000000-0000-0000-0000-000000000001"
_DEMO_AGENT_ID        = "00000000-0000-0000-0000-000000000002"


def _seed_demo_brokerage_and_agent(db) -> None:
    """Ensure the demo brokerage and agent rows exist (idempotent)."""

    # ── Brokerage ──────────────────────────────────────────────────────
    brokerage_exists = db.table("brokerages") \
        .select("id").eq("id", _DEFAULT_BROKERAGE_ID).execute()

    if not brokerage_exists.data:
        try:
            db.table("brokerages").insert({
                "id":   _DEFAULT_BROKERAGE_ID,
                "name": "Demo Brokerage",
            }).execute()
            print("[seeder] Created demo brokerage")
        except Exception as exc:
            print(f"[seeder] Brokerage insert skipped: {exc}")

    # ── Agent ──────────────────────────────────────────────────────────
    agent_exists = db.table("agents") \
        .select("id").eq("id", _DEMO_AGENT_ID).execute()

    if not agent_exists.data:
        try:
            db.table("agents").insert({
                "id":           _DEMO_AGENT_ID,
                "brokerage_id": _DEFAULT_BROKERAGE_ID,
                "name":         "Demo Agent",
                "email":        "demo@coachc.ai",
            }).execute()
            print("[seeder] Created demo agent")
        except Exception as exc:
            print(f"[seeder] Agent insert skipped: {exc}")


def _ensure_storage_bucket(db) -> None:
    """Create the call-recordings bucket if it doesn't exist."""
    try:
        buckets = db.storage.list_buckets()
        bucket_names = [b.name for b in buckets]
        if "call-recordings" not in bucket_names:
            db.storage.create_bucket("call-recordings", options={"public": False})
            print("[seeder] Created 'call-recordings' storage bucket")
        else:
            pass  # already exists
    except Exception as exc:
        print(f"[seeder] Storage bucket check skipped: {exc}")


def seed_default_guidelines() -> None:
    db = get_supabase()

    # Ensure demo brokerage + agent exist before inserting guidelines
    _seed_demo_brokerage_and_agent(db)

    # Ensure storage bucket exists
    _ensure_storage_bucket(db)

    # ── Guidelines ─────────────────────────────────────────────────────
    existing = db.table("guidelines") \
        .select("call_type") \
        .eq("brokerage_id", _DEFAULT_BROKERAGE_ID) \
        .execute()
    existing_types = {row["call_type"] for row in (existing.data or [])}

    seeded = []
    for path in _GUIDELINES_DIR.glob("*.json"):
        call_type = path.stem
        if call_type in existing_types:
            continue
        content = json.loads(path.read_text())
        db.table("guidelines").insert({
            "brokerage_id": _DEFAULT_BROKERAGE_ID,
            "call_type":    call_type,
            "content":      content,
            "is_default":   True,
        }).execute()
        seeded.append(call_type)

    if seeded:
        print(f"[seeder] Seeded default guidelines: {', '.join(seeded)}")
    else:
        print("[seeder] Guidelines already seeded — skipping.")
