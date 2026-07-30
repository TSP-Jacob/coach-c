"""Voice assistant — Gemini Live relay over a WebSocket.

The browser opens ws://.../api/voice/live?token=<jwt>&tz=<iana> and streams
microphone audio (16-bit PCM, 16 kHz, mono). We proxy that into a Gemini Live
session and stream back:
  • binary frames — assistant audio (16-bit PCM, 24 kHz) for playback
  • JSON text frames — transcripts + turn/interrupt/error signals

Grounding: Gemini can call the tools in `assistant_tools`, which we execute
server-side against Supabase (scoped to the authenticated agent) and hand back.
So the assistant answers "what did I offer client X / who did I service around
date Y" from real data.
"""
import asyncio
import json
import logging
from datetime import date
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings
from app.database import get_supabase
from app.middleware.auth import resolve_agent_from_token
from app.services.assistant_tools import (
    ACTION_INSTRUCTIONS,
    TOOL_DECLARATIONS,
    build_recent_context,
    execute_tool,
)
from app.services.industry import assistant_descriptor
from app.services.history import save_messages

log = logging.getLogger("voice")
router = APIRouter()

_COACHING_PROMPT = (Path(__file__).parent.parent / "prompts" / "coaching_system.txt").read_text()

# Audio format constants (documented for the frontend to match).
INPUT_SAMPLE_RATE = 16000   # what we send Gemini
OUTPUT_SAMPLE_RATE = 24000  # what Gemini sends back


def _system_instruction(agent_name: str, tz_name: str | None, recent_context: str = "",
                        industry_mode: str | None = None) -> str:
    today = date.today().isoformat()
    base = (
        f"{_COACHING_PROMPT}\n\n"
        f"You are the voice assistant for {agent_name}, a {assistant_descriptor(industry_mode)}. "
        f"Today's date is {today}"
        + (f" ({tz_name} time). " if tz_name else ". ")
        + "You are having a spoken conversation, so keep replies natural, warm, "
        "and concise — a sentence or two unless asked for detail. "
    )
    if recent_context:
        base += (
            "\n\nBelow are the agent's recent records — their calls, clients, and "
            "notes. Treat this as your working memory: answer directly and "
            "conversationally from it, with NO lookup delay, whenever the answer "
            "is here.\n\n"
            f"{recent_context}\n\n"
            "If the user asks about something NOT in the records above — an older "
            "call, a client not listed, a full transcript, or a keyword search — "
            "use the tools (search_calls, get_client_history, search_notes) to "
            "look it up. Whenever you call a tool, FIRST say a short, natural "
            "filler out loud like 'let me pull that up' or 'one sec' so there is "
            "never dead silence, then look it up and answer. "
            "Never tell the user something doesn't exist based only on the list "
            "above — if it isn't there, check with a tool first, and only say "
            "it's not found if the tool returns nothing. "
        )
    else:
        base += (
            "When the user asks about past calls, clients, offers, scores, or "
            "dates, briefly say you're looking it up, then call the provided "
            "tools to fetch real records before answering. "
        )
    base += (
        "Never invent client names, dates, or details. Keep replies natural and "
        "brief, like a phone conversation, and mention the client and date when "
        "you reference a specific call."
    )
    base += ACTION_INSTRUCTIONS
    return base


async def _send_json(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_text(json.dumps(payload))
    except Exception:
        pass


async def _read_auth_token(ws: WebSocket, timeout: float = 10.0) -> str | None:
    """Return the JWT from the client's first frame ({"type":"auth","token":...}).

    Auth travels in the first WebSocket message instead of the URL query string,
    so the token never lands in uvicorn/proxy access logs. Returns None on
    timeout, disconnect, or a malformed / non-auth first frame.
    """
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


@router.websocket("/live")
async def voice_live(ws: WebSocket):
    await ws.accept()

    tz_name = ws.query_params.get("tz")

    if not settings.gemini_api_key:
        await _send_json(ws, {"type": "error", "message": "Voice assistant is not configured (missing Gemini key)."})
        await ws.close()
        return

    # Authenticate from the first WebSocket frame, not a URL query param, so the
    # JWT never lands in uvicorn/proxy access logs.
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

    db = get_supabase()
    industry_mode = None
    try:
        agent = db.table("agents").select("name, brokerages(industry_mode)").eq("id", agent_id).single().execute()
        agent_name = agent.data["name"] if agent.data else "the agent"
        industry_mode = (agent.data.get("brokerages") or {}).get("industry_mode") if agent.data else None
    except Exception:
        agent_name = "the agent"

    # Pre-load a digest of recent calls into the prompt so common recall
    # questions are answered without a (slow) tool round-trip. One-time cost at
    # session setup — off the per-turn hot path.
    recent_context = await asyncio.to_thread(build_recent_context, db, agent_id, tz_name)

    # Import lazily so a missing/older google-genai package can't break app boot.
    try:
        from google import genai
        from google.genai import types
    except Exception as exc:
        log.exception("google-genai import failed")
        await _send_json(ws, {"type": "error", "message": f"Voice backend unavailable: {exc}"})
        await ws.close()
        return

    client = genai.Client(api_key=settings.gemini_api_key)
    config = {
        "response_modalities": ["AUDIO"],
        "input_audio_transcription": {},
        "output_audio_transcription": {},
        # Native-audio: respond to the user's tone for more natural, less robotic
        # turn-taking (proactivity isn't supported on this model yet).
        "enable_affective_dialog": True,
        "system_instruction": _system_instruction(agent_name, tz_name, recent_context, industry_mode),
        "tools": [{"function_declarations": TOOL_DECLARATIONS}],
        # Turn-taking: respond sooner after the user stops talking. The model's
        # default end-of-speech window is conservative and is the main per-turn
        # lag; ~500 ms feels far snappier without clipping normal pauses. Tune
        # silence_duration_ms up if it ever cuts users off mid-thought.
        # Manual turn-taking (push-to-talk): the browser sends explicit
        # activity_start / activity_end signals, so the user controls exactly when
        # their turn begins and ends. A quick "yes" fires instantly and a long
        # explanation is never cut off — no silence-threshold guessing, and
        # background noise can't be mistaken for the user interrupting.
        "realtime_input_config": {
            "automatic_activity_detection": {"disabled": True},
        },
    }

    try:
        async with client.aio.live.connect(model=settings.gemini_live_model, config=config) as session:
            await _send_json(ws, {"type": "ready"})

            # Accumulates the current turn's transcript (user + assistant) so we
            # can persist it as a pair when the turn completes.
            turn = {"user": "", "assistant": ""}

            async def pump_browser_to_gemini():
                """Forward mic audio + typed text from the browser into Gemini."""
                while True:
                    msg = await ws.receive()
                    if msg.get("type") == "websocket.disconnect":
                        raise WebSocketDisconnect()
                    data = msg.get("bytes")
                    if data:
                        await session.send_realtime_input(
                            audio=types.Blob(data=data, mime_type=f"audio/pcm;rate={INPUT_SAMPLE_RATE}")
                        )
                        continue
                    text = msg.get("text")
                    if not text:
                        continue
                    try:
                        payload = json.loads(text)
                    except Exception:
                        continue
                    kind = payload.get("type")
                    if kind == "activity_start":
                        # Push-to-talk: user tapped to start speaking.
                        await session.send_realtime_input(activity_start=types.ActivityStart())
                    elif kind == "activity_end":
                        # Push-to-talk: user tapped "done" — end the turn.
                        await session.send_realtime_input(activity_end=types.ActivityEnd())
                    elif kind == "text" and payload.get("text"):
                        # Typed input isn't transcribed back to us, so capture it
                        # here for the saved history.
                        turn["user"] += payload["text"]
                        await session.send_client_content(
                            turns={"role": "user", "parts": [{"text": payload["text"]}]},
                            turn_complete=True,
                        )
                    elif kind == "end":
                        raise WebSocketDisconnect()

            async def pump_gemini_to_browser():
                """Forward Gemini audio, transcripts and tool calls to the browser.

                session.receive() yields a single model turn and then stops (the
                SDK breaks the iterator on turn_complete), so we re-enter it in a
                loop to keep the conversation alive across turns. If a turn yields
                no messages the session has closed, so we stop; when the session
                errors it raises, which also ends this task and tears down.
                """
                while True:
                    got = False
                    async for response in session.receive():
                        got = True
                        # Assistant audio (24 kHz PCM) — convenience accessor.
                        if getattr(response, "data", None):
                            await ws.send_bytes(response.data)

                        sc = getattr(response, "server_content", None)
                        if sc:
                            it = getattr(sc, "input_transcription", None)
                            if it and getattr(it, "text", None):
                                turn["user"] += it.text
                                await _send_json(ws, {"type": "input_transcript", "text": it.text})
                            ot = getattr(sc, "output_transcription", None)
                            if ot and getattr(ot, "text", None):
                                turn["assistant"] += ot.text
                                await _send_json(ws, {"type": "output_transcript", "text": ot.text})
                            if getattr(sc, "interrupted", None):
                                await _send_json(ws, {"type": "interrupted"})
                            if getattr(sc, "turn_complete", None):
                                await _send_json(ws, {"type": "turn_complete"})
                                # Persist the completed exchange (bounded history).
                                pending = []
                                if turn["user"].strip():
                                    pending.append({"role": "user", "content": turn["user"].strip(), "source": "voice"})
                                if turn["assistant"].strip():
                                    pending.append({"role": "assistant", "content": turn["assistant"].strip(), "source": "voice"})
                                if pending:
                                    try:
                                        await asyncio.to_thread(save_messages, db, agent_id, pending)
                                    except Exception:
                                        log.exception("voice: failed to save turn")
                                turn["user"] = ""
                                turn["assistant"] = ""

                        tc = getattr(response, "tool_call", None)
                        if tc and getattr(tc, "function_calls", None):
                            responses = []
                            for fc in tc.function_calls:
                                args = dict(fc.args) if fc.args else {}
                                result = await asyncio.to_thread(
                                    execute_tool, db, agent_id, fc.name, args, tz_name
                                )
                                responses.append(
                                    types.FunctionResponse(id=fc.id, name=fc.name, response=result)
                                )
                            if responses:
                                await session.send_tool_response(function_responses=responses)
                    if not got:
                        break

            send_task = asyncio.create_task(pump_browser_to_gemini())
            recv_task = asyncio.create_task(pump_gemini_to_browser())
            done, pending = await asyncio.wait(
                {send_task, recv_task}, return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
            # Surface a non-disconnect error from whichever task finished first.
            for t in done:
                exc = t.exception()
                if exc and not isinstance(exc, WebSocketDisconnect):
                    log.exception("voice task error", exc_info=exc)

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.exception("voice session error")
        await _send_json(ws, {"type": "error", "message": f"Voice session error: {exc}"})
    finally:
        try:
            await ws.close()
        except Exception:
            pass
