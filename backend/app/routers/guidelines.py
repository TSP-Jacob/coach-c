from fastapi import APIRouter
from pydantic import BaseModel
from app.database import get_supabase

router = APIRouter()

CALL_TYPES = ["prospecting", "buyer_consultation", "seller_listing", "followup", "negotiation", "post_closing"]


class GuidelineUpsert(BaseModel):
    brokerage_id: str
    call_type: str
    content: dict


@router.get("/")
def list_guidelines(brokerage_id: str):
    db = get_supabase()
    return db.table("guidelines").select("*").eq("brokerage_id", brokerage_id).execute().data


@router.put("/")
def upsert_guideline(body: GuidelineUpsert):
    db = get_supabase()
    existing = db.table("guidelines").select("id, version").eq(
        "brokerage_id", body.brokerage_id
    ).eq("call_type", body.call_type).single().execute()

    if existing.data:
        result = db.table("guidelines").update({
            "content": body.content,
            "version": existing.data["version"] + 1,
        }).eq("id", existing.data["id"]).execute()
    else:
        result = db.table("guidelines").insert({
            "brokerage_id": body.brokerage_id,
            "call_type": body.call_type,
            "content": body.content,
        }).execute()

    return result.data[0]


@router.get("/call-types")
def get_call_types():
    return CALL_TYPES
