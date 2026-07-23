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
from app.services.assistant_tools import TOOL_DECLARATIONS, execute_tool

log = logging.getLogger("voice")
router = APIRouter()

_COACHING_PROMPT = (Path(__file__).parent.parent / "prompts" / "coaching_system.txt").read_text()

# Audio format constants (documented for the frontend to match).
INPUT_SAMPLE_RATE = 16000   # what we send Gemini
OUTPUT_SAMPLE_RATE = 24000  # what Gemini sends back


def _system_instruction(agent_name: str, tz_name: str | None) -> str:
    today = date.today().isoformat()
    return (
        f"{_COACHING_PROMPT}\n\n"
        f"You are the voice assistant for {agent_name}, a real estate agent. "
        f"Today's date is {today}"
        + (f" ({tz_name} time). " if tz_name else ". ")
        + "You are having a spoken conversation, so keep replies natural, warm, "
        "and concise — a sentence or two unless asked for detail. "
        "IMPORTANT: whenever the user asks about past calls, clients, what was "
        "offered or discussed, scores, or dates, you MUST call the provided "
        "tools to look up the real records before answering. Never invent client "
        "names, dates, or details — if a tool returns nothing, say so plainly. "
        "When you reference a specific call, mention the client and the date."
    )


async def _send_json(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_text(json.dumps(payload))
    except Exception:
        pass


@router.websocket("/live")
async def voice_live(ws: WebSocket):
    await ws.accept()

    token = ws.query_params.get("token")
    tz_name = ws.query_params.get("tz")

    if not settings.gemini_api_key:
        await _send_json(ws, {"type": "error", "message": "Voice assistant is not configured (missing Gemini key)."})
        await ws.close()
        return

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
    try:
        agent = db.table("agents").select("name").eq("id", agent_id).single().execute()
        agent_name = agent.data["name"] if agent.data else "the agent"
    except Exception:
        agent_name = "the agent"

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
        "system_instruction": _system_instruction(agent_name, tz_name),
        "tools": [{"function_declarations": TOOL_DECLARATIONS}],
    }

    try:
        async with client.aio.live.connect(model=settings.gemini_live_model, config=config) as session:
            await _send_json(ws, {"type": "ready"})

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
                    if kind == "text" and payload.get("text"):
                        await session.send_client_content(
                            turns={"role": "user", "parts": [{"text": payload["text"]}]},
                            turn_complete=True,
                        )
                    elif kind == "end":
                        raise WebSocketDisconnect()

            async def pump_gemini_to_browser():
                """Forward Gemini audio, transcripts and tool calls to the browser.

                session.receive() is a long-lived async iterator for the whole
                session; it ends when the connection closes.
                """
                async for response in session.receive():
                    # Assistant audio (24 kHz PCM) — convenience accessor.
                    if getattr(response, "data", None):
                        await ws.send_bytes(response.data)

                    sc = getattr(response, "server_content", None)
                    if sc:
                        it = getattr(sc, "input_transcription", None)
                        if it and getattr(it, "text", None):
                            await _send_json(ws, {"type": "input_transcript", "text": it.text})
                        ot = getattr(sc, "output_transcription", None)
                        if ot and getattr(ot, "text", None):
                            await _send_json(ws, {"type": "output_transcript", "text": ot.text})
                        if getattr(sc, "interrupted", None):
                            await _send_json(ws, {"type": "interrupted"})
                        if getattr(sc, "turn_complete", None):
                            await _send_json(ws, {"type": "turn_complete"})

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
