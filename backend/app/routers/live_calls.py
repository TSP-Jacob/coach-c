"""Live call listen-in / takeover.

Relays a phone-agent deployment's live audio for a call currently in
progress to an authenticated admin/manager's browser, and lets them take
over from the AI agent. Mirrors voice.py's WebSocket auth (JWT in the first
frame, never the URL) and dual-pump-task bridging pattern — the difference
is the "downstream" session here is another WebSocket (the org's phone-agent
deployment's /admin-stream), not a Gemini Live session.

GET  /                     — calls currently in progress for the caller's
                              OWN org (never client-supplied; derived from
                              the authenticated agent's own brokerage_id —
                              this is the entire org-isolation guarantee).
WS   /{call_sid}/stream    — bridges the browser to that org's phone-agent
                              deployment's /admin-stream.
"""
import asyncio
import json
import logging

import httpx
import websockets
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from app.config import settings
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id, resolve_agent_from_token

log = logging.getLogger("live_calls")
router = APIRouter()


def _get_agent_org(agent_id: str) -> dict:
    """{'role', 'brokerage_id'} for this agent. Raises if the agent row is
    missing (should not normally happen for a resolved token)."""
    db = get_supabase()
    res = db.table("agents").select("id, role, brokerage_id").eq("id", agent_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=401, detail="Agent not found")
    return res.data


def _deployment_for_brokerage(brokerage_id: str) -> dict | None:
    """The org's phone-agent deployment row, or None if not configured. Each
    org has exactly one today; if more than one ever exists, take the most
    recently created rather than build a picker."""
    if not brokerage_id:
        return None
    db = get_supabase()
    rows = (db.table("phone_agent_deployments")
            .select("*").eq("brokerage_id", brokerage_id)
            .order("created_at", desc=True).limit(1).execute().data or [])
    return rows[0] if rows else None


@router.get("/")
def list_live_calls(agent_id: str = Depends(get_jwt_agent_id)):
    if not agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    agent = _get_agent_org(agent_id)
    if agent.get("role") not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Admin or manager role required")

    deployment = _deployment_for_brokerage(agent.get("brokerage_id"))
    if not deployment:
        return {"calls": [], "configured": False}

    secret = settings.admin_stream_secret
    if not secret:
        return {"calls": [], "configured": False, "error": "ADMIN_STREAM_SECRET not set on this backend"}

    try:
        with httpx.Client(timeout=6) as client:
            resp = client.get(
                deployment["base_url"].rstrip("/") + "/live-calls",
                headers={"X-Admin-Stream-Secret": secret},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        log.warning("live_calls: could not reach phone-agent deployment %s: %s", deployment["base_url"], exc)
        return {"calls": [], "configured": True, "error": "Could not reach the phone agent server"}

    return {"calls": data.get("calls", []), "configured": True}


async def _send_json(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_text(json.dumps(payload))
    except Exception:
        pass


async def _read_auth_token(ws: WebSocket, timeout: float = 10.0) -> str | None:
    """JWT arrives in the client's first frame ({"type":"auth","token":...}),
    not the URL — same reasoning as voice.py's _read_auth_token."""
    try:
        msg = await asyncio.wait_for(ws.receive(), timeout=timeout)
    except Exception:
        return None
    if msg.get("type") == "websocket.disconnect":
        return None
    text = msg.get("text")
    if not text:
        return None
    try:
        payload = json.loads(text)
    except Exception:
        return None
    if payload.get("type") == "auth":
        return payload.get("token")
    return None


@router.websocket("/{call_sid}/stream")
async def live_call_stream(ws: WebSocket, call_sid: str):
    await ws.accept()

    token = await _read_auth_token(ws)
    agent_id = None
    if token:
        try:
            agent_id = await resolve_agent_from_token(token)
        except Exception:
            agent_id = None
    if not agent_id:
        await _send_json(ws, {"type": "error", "message": "Authentication required."})
        await ws.close()
        return

    try:
        agent = _get_agent_org(agent_id)
    except HTTPException as exc:
        await _send_json(ws, {"type": "error", "message": exc.detail})
        await ws.close()
        return
    if agent.get("role") not in ("admin", "manager"):
        await _send_json(ws, {"type": "error", "message": "Admin or manager role required."})
        await ws.close()
        return

    # base_url is ALWAYS derived from the authenticated caller's own org —
    # never taken from the client. This is the entire org-isolation
    # guarantee; the shared secret below does not provide isolation on its
    # own (it's identical across every phone-agent deployment, same risk
    # posture as the existing CALL_UPLOAD_SECRET).
    deployment = _deployment_for_brokerage(agent.get("brokerage_id"))
    secret = settings.admin_stream_secret
    if not deployment or not secret:
        await _send_json(ws, {"type": "error", "message": "Live calls are not configured for this organization."})
        await ws.close()
        return

    upstream_url = (
        deployment["base_url"].rstrip("/").replace("https://", "wss://", 1).replace("http://", "ws://", 1)
        + f"/admin-stream?callSid={call_sid}"
    )

    try:
        # compression=None: the phone-agent's WebSocket server had a real,
        # confirmed bug where two ws.WebSocketServer instances on one
        # http.Server corrupted extension negotiation (RSV1 errors). That's
        # now fixed there, but audio payloads gain nothing from compression
        # anyway — disabling it here removes this whole class of risk rather
        # than trusting cross-library negotiation.
        async with websockets.connect(upstream_url, compression=None, open_timeout=10) as upstream:
            await upstream.send(json.dumps({"type": "auth", "secret": secret}))

            async def pump_browser_to_upstream():
                while True:
                    msg = await ws.receive()
                    if msg.get("type") == "websocket.disconnect":
                        raise WebSocketDisconnect()
                    data = msg.get("bytes")
                    if data is not None:
                        await upstream.send(data)
                        continue
                    text = msg.get("text")
                    if text:
                        await upstream.send(text)

            async def pump_upstream_to_browser():
                async for raw in upstream:
                    if isinstance(raw, (bytes, bytearray)):
                        await ws.send_bytes(bytes(raw))
                    else:
                        await ws.send_text(raw)

            send_task = asyncio.create_task(pump_browser_to_upstream())
            recv_task = asyncio.create_task(pump_upstream_to_browser())
            done, pending = await asyncio.wait(
                {send_task, recv_task}, return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
            for t in done:
                exc = t.exception()
                if exc and not isinstance(exc, WebSocketDisconnect):
                    log.exception("live_call_stream task error", exc_info=exc)

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.exception("live_call_stream error")
        await _send_json(ws, {"type": "error", "message": f"Live call stream error: {exc}"})
    finally:
        try:
            await ws.close()
        except Exception:
            pass
