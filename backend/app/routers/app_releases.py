"""App distribution — signed download links for apps not (yet) on an app
store. Currently just the Android call-recorder (see
website/android-app in the chardin_website repo — a separate codebase that
shares this Supabase project). Any logged-in Coach-C agent can download it;
the app itself authenticates against the same Supabase project, and resolves
the caller to their own agents.id via agents.auth_user_id, so it works for
any org's agents, not just one.
"""
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_supabase
from app.middleware.auth import get_jwt_agent_id

router = APIRouter()

_ANDROID_APK_PATH = "android/coach-c-call-recorder.apk"


@router.get("/android/download")
def get_android_download(jwt_agent_id: str | None = Depends(get_jwt_agent_id)):
    if not jwt_agent_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    db = get_supabase()
    try:
        signed = db.storage.from_("app-releases").create_signed_url(_ANDROID_APK_PATH, 300)
    except Exception:
        raise HTTPException(status_code=404, detail="No Android build available yet")
    url = signed.get("signedURL")
    if not url:
        raise HTTPException(status_code=404, detail="No Android build available yet")
    return {"url": url}
