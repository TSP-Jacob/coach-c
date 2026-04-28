import re
import uuid
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends, Query
from app.database import get_supabase
from app.services.transcription import TranscriptionService
from app.services.coaching import CoachingService
from app.services.rag import retrieve_context, index_client_notes
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()

_PHONE_RE = re.compile(r"\+?1?\s*[\-.]?\s*\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}")


def _normalize_phone(raw: str) -> str:
    return re.sub(r"\D", "", raw).lstrip("1") if raw else ""


def _extract_phone_from_filename(filename: str) -> str | None:
    match = _PHONE_RE.search(filename)
    return _normalize_phone(match.group()) if match else None


def _resolve_client(
    db,
    agent_id: str,
    coaching_svc: CoachingService,
    full_text: str,
    phone_hint: str | None,
) -> str | None:
    """Return a client_id — matching existing or creating a new profile."""
    clients = db.table("clients").select("id, name, phone, email").eq("agent_id", agent_id).execute().data

    # 1. Phone-first match (most reliable)
    if phone_hint:
        for c in clients:
            if _normalize_phone(c.get("phone") or "") == phone_hint:
                return c["id"]

    # 2. AI name/context match
    result = coaching_svc.identify_client(full_text, clients)
    if result.get("matched_client_id") and result.get("confidence") == "high":
        # Backfill phone if we found one and the profile doesn't have it
        if phone_hint:
            matched = next((c for c in clients if c["id"] == result["matched_client_id"]), None)
            if matched and not matched.get("phone"):
                db.table("clients").update({"phone": phone_hint}).eq("id", result["matched_client_id"]).execute()
        return result["matched_client_id"]

    # 3. Create new client profile
    name = result.get("extracted_name") or "Unknown Client"
    phone = phone_hint or result.get("extracted_phone")
    new_client = db.table("clients").insert({
        "agent_id": agent_id,
        "name": name,
        "phone": phone,
        "type": "buyer",
    }).execute().data[0]
    return new_client["id"]


def _get_services():
    return TranscriptionService(), CoachingService()


def _process_call(call_id: str, agent_id: str, audio_url: str, client_id: str | None, phone_hint: str | None, file_modified_at: str | None = None):
    transcription_svc, coaching_svc = _get_services()
    db = get_supabase()
    try:
        db.table("calls").update({"status": "transcribing"}).eq("id", call_id).execute()
        transcript = transcription_svc.transcribe(audio_url)
        utterances = transcript["utterances"]
        full_text = transcript.get("full_text", "")

        # Determine call start time:
        # 1. If user supplied call_date at upload, it's already stored — don't overwrite it.
        # 2. Otherwise, estimate from file's last-modified timestamp minus duration (fallback).
        existing_call_date = (db.table("calls").select("call_date").eq("id", call_id)
                               .single().execute().data or {}).get("call_date")

        call_start: str | None = None
        if not existing_call_date and file_modified_at and transcript["duration_seconds"]:
            from datetime import datetime, timedelta
            try:
                end_time = datetime.fromisoformat(file_modified_at.replace("Z", "+00:00"))
                call_start = (end_time - timedelta(seconds=transcript["duration_seconds"])).isoformat()
            except Exception:
                pass

        db.table("calls").update({
            "status": "analyzing",
            "transcript": transcript,
            "duration_seconds": transcript["duration_seconds"],
            **({"call_date": call_start} if call_start else {}),
        }).eq("id", call_id).execute()

        # Resolve client if not manually provided
        if not client_id:
            try:
                client_id = _resolve_client(db, agent_id, coaching_svc, full_text, phone_hint)
                if client_id:
                    db.table("calls").update({"client_id": client_id}).eq("id", call_id).execute()
            except Exception as resolve_err:
                print(f"[calls] client resolution failed (non-fatal): {resolve_err}")

        call_type = coaching_svc.classify_call(utterances)
        realtor_speaker = coaching_svc.identify_realtor_speaker(utterances)

        try:
            client_notes = retrieve_context(agent_id, full_text[:500])
        except Exception as rag_err:
            print(f"[calls] RAG retrieval failed (non-fatal): {rag_err}")
            client_notes = ""

        report = coaching_svc.analyze_call(utterances, call_type, realtor_speaker, client_notes)

        db.table("calls").update({
            "status": "complete",
            "call_type": call_type,
            "realtor_speaker": realtor_speaker,
            "coaching_report": report,
            "overall_score": report.get("overall_score"),
        }).eq("id", call_id).execute()

    except Exception as e:
        db.table("calls").update({"status": "error", "error_message": str(e)}).eq("id", call_id).execute()
        raise


@router.post("/upload")
async def upload_call(
    background_tasks: BackgroundTasks,
    agent_id: str | None = Form(None),
    client_id: str | None = Form(None),
    call_date: str | None = Form(None),
    phone_number: str | None = Form(None),
    file_modified_at: str | None = Form(None),
    file: UploadFile = File(...),
    jwt_agent_id: str | None = Depends(get_jwt_agent_id),
):
    effective_agent_id = jwt_agent_id or agent_id
    if not effective_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    db = get_supabase()
    file_ext = file.filename.split(".")[-1] if "." in file.filename else "m4a"
    storage_path = f"{effective_agent_id}/{uuid.uuid4()}.{file_ext}"

    # Derive phone hint: explicit form field beats filename extraction
    phone_hint: str | None = None
    if phone_number:
        phone_hint = _normalize_phone(phone_number)
    elif file.filename:
        phone_hint = _extract_phone_from_filename(file.filename)

    audio_bytes = await file.read()
    db.storage.from_("call-recordings").upload(storage_path, audio_bytes, {"content-type": file.content_type})
    audio_url = db.storage.from_("call-recordings").create_signed_url(storage_path, 3600)["signedURL"]

    call = db.table("calls").insert({
        "agent_id": effective_agent_id,
        "client_id": client_id,
        "audio_url": audio_url,
        "call_date": call_date,
        "status": "uploaded",
    }).execute().data[0]

    background_tasks.add_task(_process_call, call["id"], effective_agent_id, audio_url, client_id, phone_hint, file_modified_at)
    return {"id": call["id"], "status": "uploaded"}


@router.get("/")
def list_calls(
    agent_id: str | None = Query(None),
    jwt_agent_id: str | None = Depends(get_jwt_agent_id),
):
    effective_agent_id = jwt_agent_id or agent_id
    if not effective_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    result = db.table("calls").select(
        "id, client_id, call_date, call_type, overall_score, status, duration_seconds, created_at, coaching_report, clients(name)"
    ).eq("agent_id", effective_agent_id).order("created_at", desc=True).execute()
    return result.data


@router.get("/{call_id}")
def get_call(call_id: str):
    db = get_supabase()
    result = db.table("calls").select("*, agents(name), clients(name)").eq("id", call_id).single().execute()
    if not result.data:
        raise HTTPException(404, "Call not found")
    return result.data


@router.delete("/{call_id}")
def delete_call(call_id: str):
    db = get_supabase()
    db.table("calls").delete().eq("id", call_id).execute()
    return {"deleted": True}
