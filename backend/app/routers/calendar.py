"""
Google Calendar integration for Coach-C.

OAuth flow:
  1. Frontend links to  GET /api/calendar/auth?agent_id=XXX
  2. Backend redirects to Google consent screen
  3. Google calls back  GET /api/calendar/callback?code=XXX&state=agent_id
  4. Backend stores tokens, redirects agent to frontend

Bland AI tools (no auth — protected by BLAND_CALENDAR_KEY header):
  GET  /api/calendar/availability?agent_id=XXX&date=YYYY-MM-DD
  POST /api/calendar/book
"""

import json
import os
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from app.database import get_supabase

router = APIRouter()

SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]

# ── helpers ──────────────────────────────────────────────────────────────────

def _flow():
    """Build an OAuth2 Flow from env vars."""
    from google_auth_oauthlib.flow import Flow
    client_config = {
        "web": {
            "client_id":     os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "auth_uri":      "https://accounts.google.com/o/oauth2/auth",
            "token_uri":     "https://oauth2.googleapis.com/token",
            "redirect_uris": [os.environ["GOOGLE_REDIRECT_URI"]],
        }
    }
    flow = Flow.from_client_config(client_config, scopes=SCOPES)
    flow.redirect_uri = os.environ["GOOGLE_REDIRECT_URI"]
    return flow


def _get_credentials(agent_row: dict):
    """Build a Credentials object from stored tokens and auto-refresh if expired."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request as GRequest

    creds = Credentials(
        token=agent_row.get("google_access_token"),
        refresh_token=agent_row.get("google_refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(GRequest())
        # Persist refreshed token
        db = get_supabase()
        db.table("agents").update({
            "google_access_token": creds.token,
        }).eq("id", agent_row["id"]).execute()
    return creds


def _calendar_service(agent_row: dict):
    from googleapiclient.discovery import build
    creds = _get_credentials(agent_row)
    return build("calendar", "v3", credentials=creds)


def _check_bland_key(request: Request):
    """Verify the shared secret for Bland AI tool calls."""
    key = os.environ.get("BLAND_CALENDAR_KEY", "")
    if key and request.headers.get("x-bland-key") != key:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _get_agent(agent_id: str) -> dict:
    db = get_supabase()
    row = db.table("agents").select(
        "id, name, email, google_access_token, google_refresh_token, google_calendar_email"
    ).eq("id", agent_id).maybe_single().execute()
    if not row or not row.data:
        raise HTTPException(status_code=404, detail="Agent not found")
    return row.data


# ── OAuth endpoints ───────────────────────────────────────────────────────────

@router.get("/auth")
def start_oauth(agent_id: str = Query(...)):
    """Redirect the agent to Google's consent screen."""
    if not os.environ.get("GOOGLE_CLIENT_ID"):
        raise HTTPException(status_code=503, detail="Google Calendar not configured — add GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI to env")
    flow = _flow()
    url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=agent_id,
    )
    return RedirectResponse(url)


@router.get("/callback")
def oauth_callback(code: str = Query(...), state: str = Query(...)):
    """Handle Google's redirect, store tokens, send agent back to frontend."""
    flow = _flow()
    flow.fetch_token(code=code)
    creds = flow.credentials

    # Get the calendar owner's email
    from googleapiclient.discovery import build
    userinfo = build("oauth2", "v2", credentials=creds).userinfo().get().execute()
    calendar_email = userinfo.get("email", "")

    db = get_supabase()
    db.table("agents").update({
        "google_access_token":  creds.token,
        "google_refresh_token": creds.refresh_token,
        "google_calendar_email": calendar_email,
    }).eq("id", state).execute()

    frontend = os.environ.get("FRONTEND_URL", "https://coach-c-theta.vercel.app")
    return RedirectResponse(f"{frontend}/agents/{state}?calendar=connected")


@router.get("/status")
def calendar_status(agent_id: str = Query(...)):
    """Return whether the agent has a connected calendar."""
    agent = _get_agent(agent_id)
    connected = bool(agent.get("google_access_token"))
    return {
        "connected": connected,
        "email": agent.get("google_calendar_email") if connected else None,
    }


@router.delete("/disconnect")
def disconnect_calendar(agent_id: str = Query(...)):
    """Revoke and clear stored tokens."""
    db = get_supabase()
    db.table("agents").update({
        "google_access_token":   None,
        "google_refresh_token":  None,
        "google_calendar_email": None,
    }).eq("id", agent_id).execute()
    return {"disconnected": True}


# ── Bland AI tools (public, key-protected) ────────────────────────────────────

@router.get("/availability")
def check_availability(
    request: Request,
    agent_id: str = Query(...),
    date: str = Query(None),           # YYYY-MM-DD; defaults to today
    days: int = Query(3),              # how many days ahead to scan
    slot_minutes: int = Query(30),     # slot length
    day_start: int = Query(9),         # work day start hour
    day_end: int = Query(17),          # work day end hour
):
    """
    Return a list of free time slots for the agent.
    Called by Bland AI during a call to find meeting times.
    """
    _check_bland_key(request)
    agent = _get_agent(agent_id)
    if not agent.get("google_access_token"):
        raise HTTPException(status_code=400, detail="Agent has not connected Google Calendar")

    service = _calendar_service(agent)
    tz_name = "America/Toronto"  # TODO: make per-agent

    from zoneinfo import ZoneInfo
    tz = ZoneInfo(tz_name)

    if date:
        start_date = datetime.fromisoformat(date).replace(tzinfo=tz)
    else:
        start_date = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)

    end_date = start_date + timedelta(days=days)

    # Freebusy query
    body = {
        "timeMin": start_date.isoformat(),
        "timeMax": end_date.isoformat(),
        "timeZone": tz_name,
        "items": [{"id": "primary"}],
    }
    fb = service.freebusy().query(body=body).execute()
    busy_periods = fb.get("calendars", {}).get("primary", {}).get("busy", [])

    busy = [(datetime.fromisoformat(b["start"]), datetime.fromisoformat(b["end"])) for b in busy_periods]

    slots = []
    cursor = start_date.replace(hour=day_start, minute=0, second=0, microsecond=0)

    while cursor < end_date and len(slots) < 20:
        if cursor.hour < day_start or cursor.hour >= day_end:
            cursor = cursor.replace(hour=day_start, minute=0, second=0, microsecond=0) + timedelta(days=1)
            continue
        slot_end = cursor + timedelta(minutes=slot_minutes)
        if cursor.date() == start_date.date() and cursor < datetime.now(tz):
            cursor += timedelta(minutes=slot_minutes)
            continue
        conflict = any(b_start < slot_end and b_end > cursor for b_start, b_end in busy)
        if not conflict:
            slots.append({
                "start": cursor.strftime("%A, %B %d at %I:%M %p"),
                "start_iso": cursor.isoformat(),
                "end_iso": slot_end.isoformat(),
            })
        cursor += timedelta(minutes=slot_minutes)

    return {"agent": agent["name"], "timezone": tz_name, "available_slots": slots}


class BookingRequest(BaseModel):
    agent_id: str
    client_name: str
    client_phone: str | None = None
    client_email: str | None = None
    start_iso: str             # ISO datetime string from /availability
    duration_minutes: int = 30
    notes: str | None = None


@router.post("/book")
def book_meeting(request: Request, body: BookingRequest):
    """
    Create a Google Calendar event for the agent.
    Called by Bland AI to book a meeting confirmed on the call.
    """
    _check_bland_key(request)
    agent = _get_agent(body.agent_id)
    if not agent.get("google_access_token"):
        raise HTTPException(status_code=400, detail="Agent has not connected Google Calendar")

    service = _calendar_service(agent)
    start = datetime.fromisoformat(body.start_iso)
    end   = start + timedelta(minutes=body.duration_minutes)

    attendees = [{"email": agent.get("google_calendar_email")}]
    if body.client_email:
        attendees.append({"email": body.client_email})

    description = f"Client: {body.client_name}"
    if body.client_phone:
        description += f"\nPhone: {body.client_phone}"
    if body.notes:
        description += f"\n\nNotes: {body.notes}"
    description += "\n\nBooked via Coach-C / Bland AI"

    event = service.events().insert(
        calendarId="primary",
        body={
            "summary":     f"Meeting — {body.client_name}",
            "description": description,
            "start":       {"dateTime": start.isoformat()},
            "end":         {"dateTime": end.isoformat()},
            "attendees":   attendees,
            "reminders":   {"useDefault": True},
        },
        sendUpdates="all",
    ).execute()

    # Also record the meeting in Coach-C notes if client exists
    try:
        db = get_supabase()
        client_rows = db.table("clients").select("id").eq("phone", body.client_phone).execute().data if body.client_phone else []
        client_id = client_rows[0]["id"] if client_rows else None
        db.table("notes").insert({
            "agent_id": body.agent_id,
            "client_id": client_id,
            "content": f"Meeting booked: {start.strftime('%A, %B %d at %I:%M %p')} ({body.duration_minutes} min)\nBooked via Bland AI during call.",
        }).execute()
    except Exception:
        pass  # non-fatal

    return {
        "booked": True,
        "event_id": event.get("id"),
        "event_url": event.get("htmlLink"),
        "summary": f"Meeting booked with {body.client_name} on {start.strftime('%A, %B %d at %I:%M %p')}",
    }
