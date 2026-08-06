import json
import anthropic
from datetime import date
from pathlib import Path
from app.config import settings

_SYSTEM_PROMPT = (Path(__file__).parent.parent / "prompts" / "coaching_system.txt").read_text()
_GUIDELINES_DIR = Path(__file__).parent.parent / "prompts" / "guidelines"


def _text_of(response) -> str:
    """Join the text blocks of an Anthropic message, ignoring tool_use blocks."""
    parts = [b.text for b in response.content if getattr(b, "type", None) == "text"]
    return "".join(parts).strip()


def _load_guidelines(call_type: str) -> dict:
    path = _GUIDELINES_DIR / f"{call_type}.json"
    if path.exists():
        return json.loads(path.read_text())
    return {}


class CoachingService:
    def __init__(self):
        self.client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self.model = "claude-sonnet-4-6"

    def classify_call(self, utterances: list[dict]) -> str:
        sample = "\n".join(
            f"{u['speaker']}: {u['text']}" for u in utterances[:20]
        )
        message = self.client.messages.create(
            model=self.model,
            max_tokens=50,
            system="You are a real estate call classifier. Reply with ONLY one of these labels: prospecting, buyer_consultation, seller_listing, followup, negotiation, post_closing, unknown",
            messages=[{"role": "user", "content": f"Classify this call:\n\n{sample}"}],
        )
        return message.content[0].text.strip().lower()

    def detect_job_request(self, utterances: list[dict], today_hint: str | None = None) -> dict:
        """Decide whether the caller is asking to have work/a job done (a
        repair, installation, estimate, maintenance visit, etc.) — as opposed
        to a call with no actionable work request (billing question, wrong
        number, confirming an existing appointment with nothing new, etc.) —
        and pull out any date they gave for it."""
        today = today_hint or date.today().isoformat()
        sample = "\n".join(f"{u['speaker']}: {u['text']}" for u in utterances[:60])
        message = self.client.messages.create(
            model=self.model,
            max_tokens=200,
            system=(
                "You read a service-business phone call transcript and decide "
                "whether the caller is requesting work to be done. Reply with "
                "ONLY valid JSON — no prose, no code fences."
            ),
            messages=[{
                "role": "user",
                "content": (
                    f"Today's date is {today}.\n\n"
                    f"TRANSCRIPT:\n{sample}\n\n"
                    "Return JSON:\n"
                    '{"needs_job": true or false, '
                    '"description": "<one short phrase summarizing the work '
                    'requested, or null>", '
                    '"requested_date": "<ISO YYYY-MM-DD if the caller gave a '
                    "specific date or day (resolve relative phrases like 'next "
                    "Tuesday' using today's date above), else null>\"}"
                ),
            }],
        )
        raw = _text_of(message)
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        import re as _re
        m = _re.search(r"\{.*\}", raw, _re.DOTALL)
        if m:
            raw = m.group()
        try:
            return json.loads(raw.strip())
        except Exception:
            return {"needs_job": False, "description": None, "requested_date": None}

    def identify_realtor_speaker(self, utterances: list[dict]) -> str:
        """Returns 'A' or 'B' — whichever speaker is the realtor."""
        sample = "\n".join(
            f"Speaker {u['speaker']}: {u['text']}" for u in utterances[:30]
        )
        message = self.client.messages.create(
            model=self.model,
            max_tokens=10,
            system="You identify which speaker in a real estate call is the realtor (agent). Reply with ONLY the letter A or B.",
            messages=[{"role": "user", "content": sample}],
        )
        return message.content[0].text.strip().upper()

    def analyze_call(
        self,
        utterances: list[dict],
        call_type: str,
        realtor_speaker: str,
        client_notes: str = "",
    ) -> dict:
        guidelines = _load_guidelines(call_type)
        labeled_transcript = "\n".join(
            f"{'[REALTOR]' if u['speaker'] == realtor_speaker else '[CLIENT]'} {u['text']}"
            for u in utterances
        )

        context_block = f"CLIENT FILE NOTES:\n{client_notes}\n\n" if client_notes else ""

        user_prompt = f"""{context_block}CALL TYPE: {call_type.replace('_', ' ').title()}

GUIDELINES TO EVALUATE AGAINST:
{json.dumps(guidelines, indent=2)}

CALL TRANSCRIPT:
{labeled_transcript}

Return a JSON object with this exact structure:
{{
  "overall_score": <0-100>,
  "summary": "<2-3 sentence overview of the call>",
  "strengths": ["<specific quoted moment or behavior>", ...],
  "improvements": [
    {{
      "principle": "<guideline name>",
      "observation": "<what happened or didn't happen>",
      "suggestion": "<specific, actionable advice>"
    }}
  ],
  "principle_scores": {{
    "<principle_name>": {{ "score": <0-10>, "comment": "<one line>" }}
  }},
  "priority_focus": "<the single most impactful thing to work on next call>"
}}"""

        message = self.client.messages.create(
            model=self.model,
            max_tokens=2000,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )

        raw = message.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())

    def summarize_actions(
        self,
        leads: list[dict],
        follow_ups: list[dict],
        overdue_count: int,
        agent_name: str = "there",
    ) -> str:
        """One-sentence, dashboard-header summary of what needs attention
        among new leads and scheduled follow-ups."""
        if not leads and not follow_ups:
            return "You're all caught up — no new leads or follow-ups need attention."

        lead_lines = "\n".join(
            f"- {l.get('name') or 'Unknown'} (via {l.get('source') or 'unknown source'})"
            for l in leads[:10]
        ) or "none"
        fu_lines = "\n".join(
            f"- {f.get('name') or 'Unknown'} due {f.get('follow_up_date')}"
            for f in follow_ups[:10]
        ) or "none"

        user_prompt = f"""New leads awaiting a first response:
{lead_lines}

Scheduled follow-ups:
{fu_lines}

{overdue_count} of those follow-ups are overdue.

In ONE short, natural sentence (max 25 words, no markdown), tell {agent_name} what to prioritize right now. Name specific people only if there are 3 or fewer items total; otherwise summarize by count."""

        try:
            message = self.client.messages.create(
                model=self.model,
                max_tokens=80,
                system="You write brief, direct action-item summaries for a busy service-business owner. No preamble, no markdown, exactly one sentence.",
                messages=[{"role": "user", "content": user_prompt}],
            )
            return _text_of(message) or self._fallback_action_summary(leads, follow_ups, overdue_count)
        except Exception:
            return self._fallback_action_summary(leads, follow_ups, overdue_count)

    @staticmethod
    def _fallback_action_summary(leads: list[dict], follow_ups: list[dict], overdue_count: int) -> str:
        parts = []
        if leads:
            parts.append(f"{len(leads)} new lead{'s' if len(leads) != 1 else ''} awaiting response")
        if follow_ups:
            suffix = f" ({overdue_count} overdue)" if overdue_count else ""
            parts.append(f"{len(follow_ups)} follow-up{'s' if len(follow_ups) != 1 else ''} scheduled{suffix}")
        return (" and ".join(parts) + ".") if parts else "You're all caught up."

    def identify_client(self, full_text: str, clients: list[dict]) -> dict:
        """
        Returns:
          matched_client_id: str | None  — id of existing client, or None
          extracted_name: str | None     — name found in transcript
          extracted_phone: str | None    — phone found in transcript
          confidence: "high" | "low"
        """
        if not clients:
            client_list = "No existing clients."
        else:
            lines = [
                f"- id={c['id']} | name={c['name']} | phone={c.get('phone') or 'N/A'} | email={c.get('email') or 'N/A'}"
                for c in clients
            ]
            client_list = "\n".join(lines)

        message = self.client.messages.create(
            model=self.model,
            max_tokens=200,
            system=(
                "You extract client identity from real estate call transcripts. "
                "Reply with ONLY valid JSON — no prose, no code fences."
            ),
            messages=[{
                "role": "user",
                "content": (
                    f"EXISTING CLIENTS:\n{client_list}\n\n"
                    f"TRANSCRIPT EXCERPT:\n{full_text[:1500]}\n\n"
                    "Task: identify who the non-realtor person in this call is.\n"
                    "Return JSON:\n"
                    '{"matched_client_id": "<id from list or null>", '
                    '"extracted_name": "<full name or null>", '
                    '"extracted_phone": "<phone digits only or null>", '
                    '"confidence": "high or low"}'
                ),
            }],
        )
        raw = message.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip().rstrip("```")
        # Extract first {...} block in case Claude adds prose around it
        import re as _re
        m = _re.search(r"\{.*\}", raw, _re.DOTALL)
        if m:
            raw = m.group()
        try:
            return json.loads(raw)
        except Exception:
            return {"matched_client_id": None, "extracted_name": None, "extracted_phone": None, "confidence": "low"}

    def chat(
        self,
        message: str,
        history: list[dict],
        client_notes: str = "",
        calls_context: str = "",
        agent_name: str = "the realtor",
        tools: list[dict] | None = None,
        tool_executor=None,
        industry: str | None = None,
        tz_name: str | None = None,
    ) -> str:
        today = date.today().isoformat()
        system = (
            f"{_SYSTEM_PROMPT}\n\nYou are speaking directly with {agent_name}. Be "
            f"conversational, concise, and practical. Today's date is {today}"
            + (f" ({tz_name} time)." if tz_name else ".")
        )
        if industry:
            system += f"\n\nThis organization operates in {industry}. Use {industry} terminology (e.g. clients, jobs, services) rather than real-estate-specific terms where possible."

        if calls_context:
            system += f"\n\nAGENT'S CALL HISTORY (use this to answer questions about specific calls, clients, scores, and dates):\n{calls_context}"

        if client_notes:
            system += f"\n\nCLIENT FILE NOTES:\n{client_notes}"

        messages = history[-20:] + [{"role": "user", "content": message}]

        # No tools wired → single completion (original behaviour).
        if not tools or tool_executor is None:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=1000,
                system=system,
                messages=messages,
            )
            return _text_of(response)

        # Tool-use loop: let Claude look things up and record work (create_client,
        # add_note, …). Cap iterations so a misbehaving loop can't run away.
        from app.services.assistant_tools import ACTION_INSTRUCTIONS
        system += ACTION_INSTRUCTIONS

        for _ in range(6):
            response = self.client.messages.create(
                model=self.model,
                max_tokens=1000,
                system=system,
                messages=messages,
                tools=tools,
            )
            if response.stop_reason != "tool_use":
                return _text_of(response)

            # Echo the assistant's turn back, then answer every tool_use block.
            messages.append({"role": "assistant", "content": response.content})
            tool_results = []
            for block in response.content:
                if getattr(block, "type", None) != "tool_use":
                    continue
                result = tool_executor(block.name, dict(block.input or {}))
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result),
                })
            messages.append({"role": "user", "content": tool_results})

        # Exhausted the loop — ask Claude for a final text answer with no tools.
        response = self.client.messages.create(
            model=self.model,
            max_tokens=1000,
            system=system,
            messages=messages,
        )
        return _text_of(response)
