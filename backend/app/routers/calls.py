import os
import re
import uuid
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends, Query, Request
import httpx
from app.database import get_supabase
from app.services.transcription import TranscriptionService
from app.services.coaching import CoachingService
from app.services.rag import retrieve_context, index_client_notes
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()

_PHONE_RE = re.compile(r"\+?1?\s*[\-.]?\s*\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}")

# Signed URLs expire after 1 hour. Extract the storage path so we can re-sign on every request.
_STORAGE_PATH_RE = re.compile(r"/object/sign/call-recordings/(.+?)(?:\?|$)")

def _refresh_audio_url(db, stored_url: str) -> str:
    """Return a fresh 1-hour signed URL, falling back to the stored one on any error."""
    match = _STORAGE_PATH_RE.search(stored_url)
    if not match:
        return stored_url
    try:
        result = db.storage.from_("call-recordings").create_signed_url(match.group(1), 3600)
        return result.get("signedURL") or stored_url
    except Exception:
        return stored_url


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
) -> tuple[str | None, bool, str | None]:
    """Return (client_id, is_new_client, name) — matching existing or creating a new profile."""
    clients = db.table("clients").select("id, name, phone, email").eq("agent_id", agent_id).execute().data

    # 1. Phone-first match (most reliable)
    if phone_hint:
        for c in clients:
            if _normalize_phone(c.get("phone") or "") == phone_hint:
                return c["id"], False, c.get("name")

    # 2. AI name/context match
    result = coaching_svc.identify_client(full_text, clients)
    if result.get("matched_client_id") and result.get("confidence") == "high":
        # Backfill phone if we found one and the profile doesn't have it
        if phone_hint:
            matched = next((c for c in clients if c["id"] == result["matched_client_id"]), None)
            if matched and not matched.get("phone"):
                db.table("clients").update({"phone": phone_hint}).eq("id", result["matched_client_id"]).execute()
        return result["matched_client_id"], False, None

    # 3. Create new client profile
    name = result.get("extracted_name") or "Unknown Client"
    phone = phone_hint or result.get("extracted_phone")
    new_client = db.table("clients").insert({
        "agent_id": agent_id,
        "name": name,
        "phone": phone,
        "type": "buyer",
    }).execute().data[0]
    return new_client["id"], True, name


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
                client_id, is_new_lead, lead_name = _resolve_client(db, agent_id, coaching_svc, full_text, phone_hint)
                if client_id:
                    db.table("calls").update({"client_id": client_id}).eq("id", call_id).execute()
                if is_new_lead and client_id:
                    db.table("leads").insert({
                        "agent_id": agent_id,
                        "name": lead_name or "Unknown Client",
                        "phone": phone_hint,
                        "source": "call",
                        "status": "new",
                        "call_id": call_id,
                    }).execute()
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


@router.post("/webhook/bland")
async def bland_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Receives Bland.ai call_ended webhooks.
    Matches the call to a Coach-C agent by their bland_phone_number,
    downloads the recording, uploads it to storage, inserts a call record,
    and kicks off the full coaching-analysis pipeline.
    """
    # Respond immediately so Bland doesn't time out
    body = await request.json()

    # Optional signature check
    bland_secret = os.getenv("BLAND_WEBHOOK_SECRET")
    if bland_secret:
        sig = (request.headers.get("x-bland-signature")
               or request.headers.get("bland-signature", ""))
        if sig != bland_secret:
            return {"error": "invalid signature"}

    call_id      = body.get("call_id")
    recording_url = body.get("recording_url")
    if not call_id or not recording_url:
        return {"received": True, "ignored": "missing call_id or recording_url"}

    to_number   = body.get("to") or ""
    from_number = body.get("from") or ""
    direction   = (body.get("direction") or "inbound").lower()
    call_length = body.get("call_length")          # Bland reports minutes
    duration_sec = int(float(call_length) * 60) if call_length else None
    created_at   = body.get("created_at") or datetime.utcnow().isoformat()

    db = get_supabase()

    # ── Match agent by bland_phone_number ─────────────────────────
    to_digits = re.sub(r"\D", "", to_number)[-10:] if to_number else ""
    agent = None

    if to_digits:
        rows = db.table("agents").select("id, bland_phone_number").execute().data or []
        for row in rows:
            stored = re.sub(r"\D", "", row.get("bland_phone_number") or "")[-10:]
            if stored and stored == to_digits:
                agent = row
                break

    # Fallback: match by agent_email in Bland metadata
    if not agent:
        agent_email = (body.get("metadata") or {}).get("agent_email", "")
        if agent_email:
            result = (db.table("agents").select("id")
                      .eq("email", agent_email.lower())
                      .maybe_single().execute())
            if result and result.data:
                agent = result.data

    if not agent:
        print(f"[bland_webhook] No agent matched — to={to_number}")
        return {"received": True, "ignored": f"no agent matched for to={to_number}"}

    # ── Download recording ────────────────────────────────────────
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=60) as client:
            resp = await client.get(recording_url)
            resp.raise_for_status()
            audio_bytes = resp.content
    except Exception as exc:
        print(f"[bland_webhook] Recording download failed: {exc}")
        return {"received": True, "error": "recording download failed"}

    # ── Upload to Supabase Storage ────────────────────────────────
    storage_path = f"{agent['id']}/{call_id}.mp3"
    try:
        db.storage.from_("call-recordings").upload(
            storage_path, audio_bytes, {"content-type": "audio/mpeg"}
        )
        signed = db.storage.from_("call-recordings").create_signed_url(storage_path, 3600)
        audio_url = signed.get("signedURL") or storage_path
    except Exception as exc:
        print(f"[bland_webhook] Storage upload failed: {exc}")
        return {"received": True, "error": "storage upload failed"}

    # ── Insert call record ────────────────────────────────────────
    phone_hint = re.sub(r"\D", "", from_number)[-10:] if from_number else None

    # NOTE: do NOT set call_type here — that column is constrained to the
    # coaching classification values and is populated later by _process_call.
    call = db.table("calls").insert({
        "agent_id":         agent["id"],
        "audio_url":        audio_url,
        "call_date":        created_at,
        "status":           "uploaded",
        "duration_seconds": duration_sec,
    }).execute().data[0]

    # ── Trigger coaching pipeline in background ───────────────────
    background_tasks.add_task(
        _process_call,
        call["id"], agent["id"], audio_url,
        None,           # client_id — resolved inside _process_call
        phone_hint,
        created_at,
    )

    print(f"[bland_webhook] Ingested call {call_id} → Coach-C call {call['id']} for agent {agent['id']}")
    return {"received": True, "call_id": call["id"]}


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
    call = result.data
    if call.get("audio_url"):
        call["audio_url"] = _refresh_audio_url(db, call["audio_url"])
    return call


@router.delete("/{call_id}")
def delete_call(call_id: str):
    db = get_supabase()
    db.table("calls").delete().eq("id", call_id).execute()
    return {"deleted": True}
