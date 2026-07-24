from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str
    assemblyai_api_key: str
    supabase_url: str
    supabase_service_role_key: str
    # Gemini Live (voice assistant). Live API key from Google AI Studio / Vertex.
    # If unset, the /api/voice/live WebSocket refuses connections.
    gemini_api_key: str = ""
    # Live model id — override per whatever your key has access to. Must be a
    # model that supports the Live API (bidiGenerateContent); list yours with
    # GET v1beta/models and filter supportedGenerationMethods.
    gemini_live_model: str = "gemini-2.5-flash-native-audio-latest"
    # Stripe (optional — billing features disabled if not set)
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""
    # URL of the Coach-C frontend (used for Stripe redirect URLs)
    frontend_url: str = "https://coach-c-theta.vercel.app"
    # Twilio (optional — inbound call recording disabled if not set).
    # Account SID + Auth Token are required to download call recordings.
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    # Optional shared secret: if set, Twilio webhook URLs must include ?k=<secret>.
    twilio_webhook_secret: str = ""

    class Config:
        env_file = ".env"
        # Ignore .env keys not modelled here (e.g. HOMEVALUE_WEBHOOK_SECRET,
        # read directly via os.environ in routers/leads.py).
        extra = "ignore"


settings = Settings()
