import assemblyai as aai
from app.config import settings


class TranscriptionService:
    def transcribe(self, audio_url: str, word_boost: list[str] | None = None) -> dict:
        aai.settings.api_key = settings.assemblyai_api_key
        config = aai.TranscriptionConfig(
            speech_models=["universal-2"],
            speaker_labels=True,
            speakers_expected=2,
            punctuate=True,
            format_text=True,
        )
        # Bias recognition toward the org's own name (e.g. "Air Santé Air Care")
        # so it doesn't come out phonetically garbled — AssemblyAI's word_boost
        # nudges the model toward these words/phrases without forcing them.
        if word_boost:
            config.set_word_boost(word_boost, boost="high")
        transcriber = aai.Transcriber()
        result = transcriber.transcribe(audio_url, config)

        if result.status == aai.TranscriptStatus.error:
            raise RuntimeError(f"AssemblyAI error: {result.error}")

        utterances = [
            {
                "speaker": u.speaker,
                "text": u.text,
                "start_ms": u.start,
                "end_ms": u.end,
                "confidence": u.confidence,
            }
            for u in (result.utterances or [])
        ]

        return {
            "assemblyai_id": result.id,
            "full_text": result.text,
            "utterances": utterances,
            "duration_seconds": int((result.audio_duration or 0)),
        }
