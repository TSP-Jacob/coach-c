# Coach-C — AI Sales Coach for Real Estate

Built by Propria Systems.

## Setup (5 steps)

### 1. Supabase
- Create a project at supabase.com
- Run `supabase/schema.sql` in the SQL editor
- Create a storage bucket named `call-recordings` (private)
- Copy your project URL and service role key

### 2. API Keys
- **Anthropic**: console.anthropic.com → API Keys
- **AssemblyAI**: assemblyai.com → API Keys  
- **OpenAI**: platform.openai.com → API Keys (embeddings only, ~$0/month at this scale)

### 3. Backend
```bash
cd backend
cp .env.example .env   # fill in your keys
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### 4. Frontend
```bash
cd frontend
cp .env.example .env.local   # fill in API URL + a valid agent UUID
npm install
npm run dev
```

### 5. Seed a demo agent
Run this in the Supabase SQL editor to create a brokerage + agent for testing:
```sql
insert into brokerages (id, name) values ('00000000-0000-0000-0000-000000000001', 'Demo Brokerage');
insert into agents (id, brokerage_id, name, email)
values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Demo Agent', 'demo@example.com');
```
Then set `NEXT_PUBLIC_DEMO_AGENT_ID=00000000-0000-0000-0000-000000000002` in `.env.local`.

## Project Structure

```
Coach-C/
├── backend/                  # FastAPI (Python)
│   └── app/
│       ├── services/
│       │   ├── transcription.py   # AssemblyAI — transcribe + diarize
│       │   ├── coaching.py        # Claude API — analyze + chat
│       │   └── rag.py             # OpenAI embeddings + pgvector search
│       ├── routers/               # /api/calls, /api/agents, /api/chat, /api/guidelines
│       └── prompts/               # System prompt + 5 call-type guidelines
├── frontend/                 # Next.js 14
│   ├── app/                  # Dashboard, Calls, Call Detail, Chat
│   └── components/           # CallUpload, CoachingReport, TranscriptViewer, ChatInterface
└── supabase/
    └── schema.sql            # Full DB schema with pgvector
```

## How It Works

1. **Upload** an MP3/M4A/WAV call recording
2. **AssemblyAI** transcribes it and separates the two speakers
3. **Claude** identifies which speaker is the realtor, classifies the call type, then scores it against the relevant guideline set
4. A **coaching report** is generated: score, strengths, improvements, principle-by-principle breakdown
5. The **Chat** page lets realtors talk to Coach-C directly — it draws on client file notes via RAG to give personalized guidance

## Adding Client Notes (RAG)
POST to `/api/agents/clients` with a `notes` field — the system automatically chunks, embeds, and indexes the notes for retrieval during call analysis and chat.
