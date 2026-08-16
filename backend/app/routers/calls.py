import hmac
import os
import re
import uuid
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Form, Header, HTTPException, BackgroundTasks, Depends, Query, Request
from fastapi.responses import Response
import httpx
from app.database import get_supabase
from app.config import settings
from app.services.transcription import TranscriptionService
from app.services.coaching import CoachingService
from app.services.rag import retrieve_context, index_client_notes
from app.middleware.auth import get_jwt_agent_id
from app.routers.phone_numbers import normalize_number
from app.services.industry import normalize_mode

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
    brokerage_id: str | None = None,
) -> tuple[str | None, bool, str | None]:
    """Return (client_id, is_new_client, name) — matching existing or creating a new profile."""
    clients = db.table("clients").select("id, name, phone, email").eq("agent_id", agent_id).execute().data

    # 1. Phone-first match (most reliable)
    if phone_hint:
        for c in clients:
            if _normalize_phone(c.get("phone") or "") == phone_hint:
                name = c.get("name")
                # A repeat caller matched by phone shouldn't stay "Unknown
                # Client" forever just because an earlier call never caught
                # their name — try to backfill it from THIS call's transcript.
                if not name or name.strip().lower() == "unknown client":
                    extracted = coaching_svc.identify_client(full_text, []).get("extracted_name")
                    if extracted:
                        db.table("clients").update({"name": extracted}).eq("id", c["id"]).execute()
                        name = extracted
                return c["id"], False, name

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
        **({"brokerage_id": brokerage_id} if brokerage_id else {}),
    }).execute().data[0]
    return new_client["id"], True, name


def _get_services():
    return TranscriptionService(), CoachingService()


def _process_call(call_id: str, agent_id: str, audio_url: str, client_id: str | None, phone_hint: str | None, file_modified_at: str | None = None, brokerage_id: str | None = None):
    transcription_svc, coaching_svc = _get_services()
    db = get_supabase()
    try:
        try:
            agent_row = db.table("agents").select("language").eq("id", agent_id).single().execute().data
            language = (agent_row or {}).get("language") or "en"
        except Exception:
            language = "en"

        # Org name (for STT word-boost, so it doesn't come out phonetically
        # garbled) and industry_mode (so coaching/labels use the right domain
        # language instead of assuming real estate) — tolerate the
        # industry_mode column not existing yet (migration 008), same pattern
        # used elsewhere in this codebase.
        org_name = None
        industry_mode = None
        if brokerage_id:
            try:
                org_row = db.table("brokerages").select("name, industry_mode").eq("id", brokerage_id).single().execute().data
                org_name = (org_row or {}).get("name")
                industry_mode = (org_row or {}).get("industry_mode")
            except Exception:
                try:
                    org_row = db.table("brokerages").select("name").eq("id", brokerage_id).single().execute().data
                    org_name = (org_row or {}).get("name")
                except Exception:
                    pass
        industry_mode = normalize_mode(industry_mode)

        db.table("calls").update({"status": "transcribing"}).eq("id", call_id).execute()
        transcript = transcription_svc.transcribe(audio_url, word_boost=[org_name] if org_name else None)
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
        resolved_name = None
        if not client_id:
            try:
                client_id, _is_new_client, resolved_name = _resolve_client(db, agent_id, coaching_svc, full_text, phone_hint, brokerage_id)
                if client_id:
                    db.table("calls").update({"client_id": client_id}).eq("id", call_id).execute()
            except Exception as resolve_err:
                print(f"[calls] client resolution failed (non-fatal): {resolve_err}")

        # Detect whether this call is a request for a new job — if so, surface
        # it in the Leads ("New Jobs" for home-services orgs) section. Runs for
        # EVERY call, new or existing client: an existing client calling about
        # another job creates a lead too, not just first-time callers.
        try:
            job = coaching_svc.detect_job_request(utterances, call_start or existing_call_date, language)
            # A job lead must always be tied to a client record (never just a
            # name floating in Leads/New Jobs) — skip if client resolution
            # above failed, rather than create an orphaned lead.
            if job.get("needs_job") and client_id:
                lead_name = resolved_name
                if not lead_name and client_id:
                    client_row = db.table("clients").select("name").eq("id", client_id).single().execute().data
                    lead_name = (client_row or {}).get("name")
                db.table("leads").insert({
                    "agent_id": agent_id,
                    "client_id": client_id,
                    "name": lead_name or "Unknown Client",
                    "phone": phone_hint,
                    "source": "call",
                    "status": "new",
                    "call_id": call_id,
                    "job_description": job.get("description"),
                    "job_date": job.get("requested_date") or None,
                    **({"brokerage_id": brokerage_id} if brokerage_id else {}),
                }).execute()
        except Exception as job_err:
            print(f"[calls] job detection failed (non-fatal): {job_err}")

        call_type = coaching_svc.classify_call(utterances)
        realtor_speaker = coaching_svc.identify_realtor_speaker(utterances, industry_mode)

        try:
            client_notes = retrieve_context(agent_id, full_text[:500])
        except Exception as rag_err:
            print(f"[calls] RAG retrieval failed (non-fatal): {rag_err}")
            client_notes = ""

        report = coaching_svc.analyze_call(utterances, call_type, realtor_speaker, client_notes, language, industry_mode)

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


@router.post("/{call_id}/ingest")
def ingest_call(
    call_id: str,
    background_tasks: BackgroundTasks,
    x_upload_secret: str | None = Header(None, alias="X-Upload-Secret"),
):
    """Server-to-server: trigger the transcription/coaching pipeline for a call
    whose row + audio were already written directly to storage by another
    system (e.g. chardin_website's Android upload flow, which shares this
    Supabase project but can't run Python). Requires CALL_UPLOAD_SECRET, same
    as /upload's server-to-server path."""
    if settings.call_upload_secret:
        if not x_upload_secret or not hmac.compare_digest(x_upload_secret, settings.call_upload_secret):
            raise HTTPException(status_code=401, detail="Invalid upload secret")

    db = get_supabase()
    result = (db.table("calls")
              .select("id, agent_id, audio_url, from_number, to_number, brokerage_id, status")
              .eq("id", call_id).maybe_single().execute())
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Call not found")
    row = result.data

    if row.get("status") != "uploaded":
        return {"queued": False, "reason": f"status is '{row.get('status')}', not ingestible"}
    if not row.get("audio_url"):
        raise HTTPException(status_code=400, detail="No audio uploaded for this call")

    # audio_url as written by the direct-upload flow is a bare storage path,
    # not a fetchable URL — resolve + persist a signed URL like every other
    # ingestion path in this file does.
    audio_url = row["audio_url"]
    if not audio_url.startswith("http"):
        signed = db.storage.from_("call-recordings").create_signed_url(audio_url, 3600)
        audio_url = signed.get("signedURL") or audio_url
        db.table("calls").update({"audio_url": audio_url}).eq("id", call_id).execute()

    phone_hint = row.get("from_number") or row.get("to_number")
    background_tasks.add_task(
        _process_call, call_id, row["agent_id"], audio_url,
        None, phone_hint, None, row.get("brokerage_id"),
    )
    return {"queued": True}


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
        "from_number":      from_number or None,
        "to_number":        to_number or None,
        "direction":        direction,
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


def _twilio_callback_url(request: Request, path: str) -> str:
    """Absolute https URL Twilio should call back. Forces https (Railway proxy
    may report http) and carries the optional shared-secret query param."""
    base = str(request.base_url).rstrip("/")
    if base.startswith("http://"):
        base = "https://" + base[len("http://"):]
    url = f"{base}{path}"
    if settings.twilio_webhook_secret:
        url += f"?k={settings.twilio_webhook_secret}"
    return url


def _twilio_secret_ok(request: Request) -> bool:
    """If a shared secret is configured, the webhook URL must carry ?k=<secret>."""
    if not settings.twilio_webhook_secret:
        return True
    return request.query_params.get("k") == settings.twilio_webhook_secret


@router.post("/webhook/twilio/voice")
async def twilio_voice(request: Request):
    """
    Twilio Voice webhook for an inbound call. Looks up the dialed number's org,
    then returns TwiML that either bridges to the org's real line (recording both
    legs) or records a message. The recording-complete callback ingests it.
    """
    if not _twilio_secret_ok(request):
        raise HTTPException(status_code=403, detail="Invalid webhook secret")

    form = await request.form()
    to_number = form.get("To") or form.get("Called") or ""
    db = get_supabase()
    dialed = normalize_number(to_number)

    forward_to = None
    if dialed:
        pn = (db.table("phone_numbers").select("forward_to")
              .eq("number", dialed).eq("active", True).maybe_single().execute())
        if pn and pn.data:
            forward_to = pn.data.get("forward_to")

    callback = _twilio_callback_url(request, "/api/calls/webhook/twilio/recording")

    if forward_to:
        twiml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            "<Response>"
            f'<Dial record="record-from-answer-dual" recordingStatusCallback="{callback}" '
            'recordingStatusCallbackEvent="completed" answerOnBridge="true">'
            f"<Number>{forward_to}</Number>"
            "</Dial>"
            "</Response>"
        )
    else:
        twiml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            "<Response>"
            "<Say>Thank you for calling. Please leave your name, number, and a brief "
            "message after the tone.</Say>"
            f'<Record maxLength="180" playBeep="true" recordingStatusCallback="{callback}" '
            'recordingStatusCallbackEvent="completed"/>'
            "</Response>"
        )
    return Response(content=twiml, media_type="application/xml")


@router.post("/webhook/twilio/recording")
async def twilio_recording(request: Request, background_tasks: BackgroundTasks):
    """Twilio recording-complete callback: download the recording, attach it to
    the org that owns the dialed number, and run the coaching pipeline."""
    _EMPTY = Response(content="<Response/>", media_type="application/xml")
    if not _twilio_secret_ok(request):
        raise HTTPException(status_code=403, detail="Invalid webhook secret")

    form = await request.form()
    recording_url = form.get("RecordingUrl")
    call_sid = form.get("CallSid") or form.get("RecordingSid") or uuid.uuid4().hex
    to_number = form.get("To") or form.get("Called") or ""
    from_number = form.get("From") or form.get("Caller") or ""
    duration = form.get("RecordingDuration")
    if not recording_url:
        return _EMPTY

    sid, token = settings.twilio_account_sid, settings.twilio_auth_token
    if not (sid and token):
        print("[twilio_recording] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — cannot fetch recording")
        return _EMPTY

    db = get_supabase()
    dialed = normalize_number(to_number)
    pn = (db.table("phone_numbers").select("brokerage_id, agent_id")
          .eq("number", dialed).maybe_single().execute())
    if not pn or not pn.data:
        print(f"[twilio_recording] no phone_numbers match for To={to_number}")
        return _EMPTY
    brokerage_id = pn.data["brokerage_id"]
    agent_id = pn.data["agent_id"]
    if not agent_id:
        print(f"[twilio_recording] no inbound agent on phone_numbers for org {brokerage_id}")
        return _EMPTY

    # Download the recording (Twilio needs Basic auth; .mp3 yields a playable file)
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=60) as client:
            resp = await client.get(f"{recording_url}.mp3", auth=(sid, token))
            resp.raise_for_status()
            audio_bytes = resp.content
    except Exception as exc:
        print(f"[twilio_recording] recording download failed: {exc}")
        return _EMPTY

    storage_path = f"{agent_id}/twilio-{call_sid}.mp3"
    try:
        db.storage.from_("call-recordings").upload(storage_path, audio_bytes, {"content-type": "audio/mpeg"})
        signed = db.storage.from_("call-recordings").create_signed_url(storage_path, 3600)
        audio_url = signed.get("signedURL") or storage_path
    except Exception as exc:
        print(f"[twilio_recording] storage upload failed: {exc}")
        return _EMPTY

    phone_hint = normalize_number(from_number) or None
    dur = int(duration) if duration and str(duration).isdigit() else None

    call = db.table("calls").insert({
        "agent_id":         agent_id,
        "brokerage_id":     brokerage_id,
        "audio_url":        audio_url,
        "call_date":        datetime.utcnow().isoformat(),
        "status":           "uploaded",
        "duration_seconds": dur,
        "from_number":      normalize_number(from_number) or None,
        "to_number":        dialed or None,
        "direction":        "inbound",
    }).execute().data[0]

    background_tasks.add_task(
        _process_call,
        call["id"], agent_id, audio_url,
        None,           # client_id — resolved inside _process_call
        phone_hint,
        None,           # file_modified_at
        brokerage_id,
    )
    print(f"[twilio_recording] Ingested Twilio call {call_sid} → Coach-C call {call['id']} for org {brokerage_id}")
    return _EMPTY


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
    x_upload_secret: str | None = Header(None, alias="X-Upload-Secret"),
):
    effective_agent_id = jwt_agent_id or agent_id
    if not effective_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # A logged-in browser session (jwt_agent_id) is already authenticated —
    # the secret only gates the agent_id-only fallback used by server-to-server
    # callers (e.g. an AI phone agent), and only when one is configured.
    if not jwt_agent_id and settings.call_upload_secret:
        if not x_upload_secret or not hmac.compare_digest(x_upload_secret, settings.call_upload_secret):
            raise HTTPException(status_code=401, detail="Invalid upload secret")

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
        "from_number": phone_hint,
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
        "id, client_id, call_date, call_type, overall_score, status, duration_seconds, direction, created_at, coaching_report, clients(name)"
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


@router.get("/insights/me")
def my_coaching_insights(jwt_agent_id: str | None = Depends(get_jwt_agent_id)):
    """
    Personal coaching insights for the currently logged-in agent.
    Used on the employee/agent dashboard to surface actionable feedback.
    Returns:
      - needs_review: calls scored below 70 not yet reviewed
      - top_strength: most consistently praised principle across recent reports
      - top_improvement: principle flagged most often for improvement
      - recent_trend: direction of last-5-calls scores (up / down / steady)
      - unread_reports: count of complete calls the agent hasn't opened yet
    """
    if not jwt_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    db = get_supabase()
    calls = (db.table("calls")
             .select("id, overall_score, status, coaching_report, created_at")
             .eq("agent_id", jwt_agent_id)
             .eq("status", "complete")
             .order("created_at", desc=True)
             .limit(50)
             .execute().data or [])

    needs_review = [c["id"] for c in calls if (c.get("overall_score") or 100) < 70]

    # Tally principle scores across reports
    principle_scores: dict[str, list[int]] = {}
    for c in calls:
        report = c.get("coaching_report") or {}
        for principle, data in (report.get("principle_scores") or {}).items():
            principle_scores.setdefault(principle, []).append(data.get("score", 50))

    top_strength   = None
    top_improvement = None
    if principle_scores:
        avgs = {p: sum(v) / len(v) for p, v in principle_scores.items()}
        top_strength    = max(avgs, key=avgs.get)
        top_improvement = min(avgs, key=avgs.get)

    # Recent trend from last 5 scored calls
    recent_scores = [c["overall_score"] for c in calls[:5] if c.get("overall_score") is not None]
    recent_trend = "steady"
    if len(recent_scores) >= 3:
        if recent_scores[0] > recent_scores[-1] + 3:
            recent_trend = "up"
        elif recent_scores[0] < recent_scores[-1] - 3:
            recent_trend = "down"

    return {
        "needs_review_count": len(needs_review),
        "needs_review_ids":   needs_review[:5],
        "top_strength":       top_strength.replace("_", " ").title() if top_strength else None,
        "top_improvement":    top_improvement.replace("_", " ").title() if top_improvement else None,
        "recent_trend":       recent_trend,
        "total_complete":     len(calls),
    }
