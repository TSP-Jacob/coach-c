# RAG Upgrade Plan (deferred, ready-to-execute)

Semantic retrieval over the **full** call/note history, so the assistant can
answer about *any* record — not just the recent window we pre-load — without
bloating the prompt. **Not built yet, by design.** This is the plan for when a
real signal says it's time.

## Current state (as of this writing)
- `backend/app/services/rag.py` is **stubbed**: `index_client_notes()` is a
  no-op and `retrieve_context()` returns `""`. Nothing is embedded.
- The `client_note_chunks` table (pgvector `vector(384)`) exists but is **empty
  and unused**.
- **No embedding provider is wired** — no OpenAI/Voyage/Gemini-embeddings key in
  the backend env.
- Today the voice assistant uses a **bounded pre-loaded context** (recent calls
  + clients + notes, capped) plus **on-demand tools** (`search_calls`,
  `get_client_history`, `search_notes`) that query the full DB by keyword/filter.

## Why it's deferred (not "waiting for pain")
- **No cliff:** the pre-load is capped (~4K tokens, constant regardless of DB
  size) and the tools already reach the full history. As data grows, more
  old-data questions just take a tool lookup — graceful, visible degradation.
- **Backfill is easy anytime:** the one thing people fear can't be added later —
  re-indexing existing rows — is a simple batch job, so building early buys
  almost nothing.
- **Tuning needs real queries:** chunking, top-k, and thresholds are only worth
  tuning against real usage patterns, which don't exist pre-launch.

## Triggers to build it
Build when any of these is true:
- Agents routinely have **hundreds+ of calls**, so the recent window covers a
  small fraction of what they ask about.
- Users ask **fuzzy/conceptual** questions ("which calls went badly on
  pricing?") that keyword search handles poorly.
- The "let me pull that up" tool lookups become frequent enough to feel slow.

## First decision (blocks everything else)
**Pick an embedding provider + dimension.** Options:
- **OpenAI** `text-embedding-3-small` (1536-dim) — cheap, strong, easy. Needs
  `OPENAI_API_KEY`. Note: `client_note_chunks.embedding` is `vector(384)`, so
  either change that column to `vector(1536)` or pick a 384-dim model.
- **Gemini embeddings** (`text-embedding-004`, 768-dim) — you already have a
  Gemini key; keeps providers consolidated.
- **Voyage** (`voyage-3`, 1024-dim) — strong retrieval quality.

Recommendation: **Gemini `text-embedding-004`** (no new vendor/key), and size the
vector column to match (768).

## Architecture
Retrieval in a **live voice session** happens through the **tool path** — the
model asks, we return relevant records mid-stream. So "RAG" here = **upgrade the
tools to semantic search**, not a re-architecture.

1. **Embed-on-write.** On call completion (and on note create), chunk the
   transcript/summary/notes and store embeddings. New table (or reuse a resized
   `client_note_chunks`) e.g. `content_chunks(id, agent_id, source_type,
   source_id, content, embedding, created_at)`.
2. **Backfill** existing calls/notes once (batch job).
3. **Retrieval helper** `retrieve(agent_id, query, top_k)` → embed the query,
   vector-search scoped to `agent_id`, return the top chunks. (Replace the
   `rag.py` stubs.)
4. **New tool** `semantic_search(query)` exposed to the voice assistant (and used
   by the text chat), which calls `retrieve(...)`. Keep the existing
   structured tools for exact filters (by name/date/type).
5. **Shrink the pre-load** to a small, stable profile — client roster + headline
   stats + last few calls — and let semantic search cover the specifics. This
   keeps the prompt tiny *and* gives full-history reach.

## Cost & maintenance
- Embedding cost is per-token, one-time per record (+ backfill). Small at these
  volumes, but it's a recurring dependency to monitor.
- A vector index (ivfflat/hnsw) needs occasional maintenance as the corpus grows.
- One more external dependency (the embedding API) in the write path — handle
  failures gracefully so a coaching call still saves if embedding hiccups.

## Effort estimate
~1–2 days: provider wiring + embed-on-write + backfill + retrieval helper + one
tool + prompt trim + basic eval on real questions.

## Until then
`007_performance_indexes.sql` keeps the structured tool queries fast at scale,
so the current bounded-preload + full-history-tools design holds up comfortably
for early users.
