import json
import anthropic
from pathlib import Path
from app.config import settings

_SYSTEM_PROMPT = (Path(__file__).parent.parent / "prompts" / "coaching_system.txt").read_text()
_GUIDELINES_DIR = Path(__file__).parent.parent / "prompts" / "guidelines"


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
    ) -> str:
        system = f"{_SYSTEM_PROMPT}\n\nYou are speaking directly with {agent_name}. Be conversational, concise, and practical."

        if calls_context:
            system += f"\n\nAGENT'S CALL HISTORY (use this to answer questions about specific calls, clients, scores, and dates):\n{calls_context}"

        if client_notes:
            system += f"\n\nCLIENT FILE NOTES:\n{client_notes}"

        messages = history[-20:] + [{"role": "user", "content": message}]
        response = self.client.messages.create(
            model=self.model,
            max_tokens=1000,
            system=system,
            messages=messages,
        )
        return response.content[0].text
