from sentence_transformers import SentenceTransformer
from app.database import get_supabase

_CHUNK_SIZE = 400  # characters
_model: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    """Lazy-load the embedding model once and reuse it."""
    global _model
    if _model is None:
        # ~90MB download on first run, then cached locally
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


def _embed(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    return model.encode(texts, convert_to_numpy=True).tolist()


def _chunk_text(text: str) -> list[str]:
    words = text.split()
    chunks, current, length = [], [], 0
    for word in words:
        current.append(word)
        length += len(word) + 1
        if length >= _CHUNK_SIZE:
            chunks.append(" ".join(current))
            current, length = [], 0
    if current:
        chunks.append(" ".join(current))
    return chunks


def index_client_notes(client_id: str, notes: str):
    """Chunk and embed a client's notes, storing in Supabase."""
    db = get_supabase()
    db.table("client_note_chunks").delete().eq("client_id", client_id).execute()

    chunks = _chunk_text(notes)
    if not chunks:
        return

    embeddings = _embed(chunks)
    rows = [
        {"client_id": client_id, "content": chunk, "embedding": emb}
        for chunk, emb in zip(chunks, embeddings)
    ]
    db.table("client_note_chunks").insert(rows).execute()


def retrieve_context(agent_id: str, query: str, top_k: int = 5) -> str:
    """Return relevant client note snippets for a query."""
    [query_embedding] = _embed([query])
    db = get_supabase()
    result = db.rpc(
        "match_client_notes",
        {"query_embedding": query_embedding, "match_agent_id": agent_id, "match_count": top_k},
    ).execute()

    if not result.data:
        return ""

    lines = []
    for row in result.data:
        client = db.table("clients").select("name").eq("id", row["client_id"]).single().execute()
        name = client.data["name"] if client.data else "Unknown client"
        lines.append(f"[{name}] {row['content']}")

    return "\n".join(lines)
