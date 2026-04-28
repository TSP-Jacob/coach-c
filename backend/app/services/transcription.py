import assemblyai as aai
from app.config import settings


class TranscriptionService:
    def transcribe(self, audio_url: str) -> dict:
        aai.settings.api_key = settings.assemblyai_api_key
        config = aai.TranscriptionConfig(
            speech_models=["universal-2"],
            speaker_labels=True,
            speakers_expected=2,
            punctuate=True,
            format_text=True,
        )
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
