from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import calls, agents, chat, guidelines, billing, leads, notes, conversations, organization, consents, calendar
from app.services.seeder import seed_default_guidelines


@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_default_guidelines()
    yield


app = FastAPI(title="Coach-C API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:8080",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:8080",
        "https://chardinsystems.com",
        "https://www.chardinsystems.com",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(calls.router,      prefix="/api/calls",      tags=["calls"])
app.include_router(agents.router,     prefix="/api/agents",     tags=["agents"])
app.include_router(chat.router,       prefix="/api/chat",       tags=["chat"])
app.include_router(guidelines.router, prefix="/api/guidelines", tags=["guidelines"])
app.include_router(billing.router,    prefix="/api/billing",    tags=["billing"])
app.include_router(leads.router,      prefix="/api/leads",      tags=["leads"])
app.include_router(notes.router,          prefix="/api/notes",          tags=["notes"])
app.include_router(conversations.router,  prefix="/api/conversations",  tags=["conversations"])
app.include_router(organization.router,   prefix="/api/organization",   tags=["organization"])
app.include_router(consents.router,       prefix="/api/consents",       tags=["consents"])
app.include_router(calendar.router,       prefix="/api/calendar",       tags=["calendar"])


@app.get("/health")
def health():
    return {"status": "ok", "bland_webhook": True}
