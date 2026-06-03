from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str
    assemblyai_api_key: str
    supabase_url: str
    supabase_service_role_key: str
    # Stripe (optional — billing features disabled if not set)
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""
    # URL of the Coach-C frontend (used for Stripe redirect URLs)
    frontend_url: str = "https://coach-c-theta.vercel.app"

    class Config:
        env_file = ".env"


settings = Settings()
