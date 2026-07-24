# UAT Environment Setup

A UAT stack that mirrors production but is fully isolated from it.

| | Production | UAT |
|---|---|---|
| Supabase project | **Chardin** (`yttqjwpqhpcdmjoprxhn`) | **Coach-C** (`lxecucwiyqkzvgfjkgwz`) |
| Git branch | `master` | `uat` |
| Backend (Railway) | `coach-c` service | a separate UAT service (branch `uat`) |
| Frontend (Vercel) | production | preview (branch `uat`) |

> ⚠️ **The project names are backwards.** The Supabase project labeled **"Coach-C"** is the **UAT/spare** DB; the one labeled **"Chardin"** is **production**. Consider renaming them to `coach-c-prod` / `coach-c-uat`.

## Step 1 — Build the UAT schema
In Supabase → **Coach-C** project → SQL Editor, run [`uat_bootstrap.sql`](./uat_bootstrap.sql) once. It applies `schema.sql` + all migrations in **dependency order** (leads before consents). Run it on the empty Coach-C project — never on Chardin.

Then create the storage bucket the app expects: Storage → New bucket → **`call-recordings`** (private).

## Step 2 — Seed sample data
Requires a logged-in test agent, which only exists after signup (auth users aren't created by SQL):
1. Deploy UAT (step 3), then **sign up a test account** on the UAT site — the backend auto-creates its `agents` row.
2. In the Coach-C SQL editor: `select id, email from agents order by created_at desc;` and copy the id.
3. Paste it into `AGENT_ID` in [`uat_seed.sql`](./uat_seed.sql) and run it (adds sample clients/calls/notes).

## Step 3 — Wire the deployments to the Coach-C DB

**Railway** — new service from the `coach-c` repo, **deploy branch = `uat`**, same variables as the prod `coach-c` service **except** Supabase points to Coach-C:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://lxecucwiyqkzvgfjkgwz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Coach-C → Settings → API → service_role key |
| `ANTHROPIC_API_KEY`, `ASSEMBLYAI_API_KEY`, `GEMINI_API_KEY`, `GEMINI_LIVE_MODEL`, `STRIPE_*` | same as prod (or Stripe **test** keys) |

Note the service's public URL (e.g. `coach-c-uat.up.railway.app`).

**Vercel** — set for the **Preview** environment (or the `uat` branch specifically):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://lxecucwiyqkzvgfjkgwz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Coach-C → Settings → API → anon key |
| `NEXT_PUBLIC_API_URL` | the UAT Railway backend URL from above |

CORS already allows any `*.vercel.app` origin (`backend/app/main.py`), so a Vercel preview needs no backend change.

## Result
A push to `uat` deploys: Vercel preview → UAT backend → Coach-C DB, with zero contact with production data.
