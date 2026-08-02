"""App distribution — signed download links for apps not (yet) on an app
store. Two separate Android apps share this same pipeline:
  - "recorder": the call-recorder (website/android-app in the
    chardin_website repo — a separate codebase that shares this Supabase
    project). Records calls and uploads them to Coach-C.
  - "dashboard": this repo's own android-app. A full companion app
    (dashboard, leads, calls, clients, follow-ups, tasks, assistant) for
    browsing/using Coach-C on the go, no call-recording permissions needed.
Any logged-in Coach-C agent can download either. Both apps authenticate
against the same Supabase project and resolve the caller to their own
agents.id via agents.auth_user_id, so this works for any org's agents, not
just one.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()

_ANDROID_APK_PATHS = {
    "recorder": "android/coach-c-call-recorder.apk",
    "dashboard": "android/coach-c-dashboard.apk",
}


@router.get("/android/download")
def get_android_download(
    app: str = Query("recorder", pattern="^(recorder|dashboard)$"),
    jwt_agent_id: str | None = Depends(get_jwt_agent_id),
):
    if not jwt_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    try:
        signed = db.storage.from_("app-releases").create_signed_url(_ANDROID_APK_PATHS[app], 300)
    except Exception:
        raise HTTPException(status_code=404, detail="No Android build available yet")
    url = signed.get("signedURL")
    if not url:
        raise HTTPException(status_code=404, detail="No Android build available yet")
    return {"url": url}
