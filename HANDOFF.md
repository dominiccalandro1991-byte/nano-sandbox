# NANO-SANDBOX / VOLTAGE CIPHER — FULL HANDOFF

**Read this file first. Do not hunt.** This is the takeover brief for the next
agent in this Grok project and for anyone cloning the GitHub repo.

**Date frozen:** 2026-08-21 ~06:30 CDT  
**Owner:** Dominic Calandro (`dominiccalandro1991-byte`)  
**Product name in UI:** Voltage Cipher Studio · NNACC  
**Git HEAD when this was written:** `78e9b1e` on `main`  
  (`Fix pooler/RLS 500s after Postgres actually connects.`)

**Standing order from owner (Block E onward):**  
Every fully built **engine** (USSE, OIAV, AEGIS, VSTE, Vault, Studio, NASE
validators, 25-engine map, stress tester) must **never** be rebuilt, rewritten,
or disconnected. Patch around them. Verify they still work after your change.

---

## 0. What this product is

A unified AI studio + research sandbox:

- One live **website** (GitHub Pages)  
- One live **API** (Render FastAPI)  
- One **Supabase Postgres** (project `sujvxxrwjqsziswuazwm`)  
- Chat (OpenRouter free models), web search (DDGS), images (Pollinations $0),
  folders/history, account/JWT, ProofPatch, plus the original engines.

It is **not** CausalRail (separate Node API). It is **not** Dream Canvas Pro
(Lovable GPT-Image-2 app). Both exist; do not mix their env vars.

---

## 1. Live URLs (canonical)

| What | URL |
|---|---|
| **The one user-facing app** | https://dominiccalandro1991-byte.github.io/nano-sandbox/ |
| Alternate path (same app) | https://dominiccalandro1991-byte.github.io/nano-sandbox/nnacc-v2/ |
| Alternate path (redirects to unified UI) | https://dominiccalandro1991-byte.github.io/nano-sandbox/platform/ |
| **API** | https://nano-sandbox-api.onrender.com |
| API health | https://nano-sandbox-api.onrender.com/health |
| API docs | https://nano-sandbox-api.onrender.com/docs |
| LLM models | https://nano-sandbox-api.onrender.com/llm/models |
| ProofPatch health | https://nano-sandbox-api.onrender.com/proofpatch/health |
| Workspace/DB smoke test | https://nano-sandbox-api.onrender.com/workspace/projects |
| Image gen (Pollinations) | https://nano-sandbox-api.onrender.com/media/image?prompt=red%20cube |
| Search | `POST https://nano-sandbox-api.onrender.com/search` `{"q":"...","max_results":2}` |
| Auth register | `POST https://nano-sandbox-api.onrender.com/auth/register` |
| ProofPatch verify | `POST https://nano-sandbox-api.onrender.com/proofpatch/verify` |

**DB connected success response (verified 2026-08-21 02:52 AM):**

```json
{"projects": []}
```

If that returns `503 workspace_db not initialized` or `500` / `ECIRCUITBREAKER`,
Postgres is wrong again — see §7.

**Health success:**

```json
{"status":"ok","service":"nano-sandbox-remote-engine","version":"0.1.0"}
```

Render free tier **spins down**. First request after idle can take 50s+.

---

## 2. Repositories

| Repo | Role |
|---|---|
| https://github.com/dominiccalandro1991-byte/nano-sandbox | **THIS PRODUCT.** UI in `public/`, API in `backend/`. |
| https://github.com/dominiccalandro1991-byte/dream-canvas-pro-8d31b443 | Lovable “Dream Canvas Pro” export. GPT-Image-2 via Lovable gateway. **Not wired in yet.** |
| https://github.com/dominiccalandro1991-byte/causalrail | **Different product.** Node/Express CI failure dashboard. Do not point nano-sandbox at it. |

GitHub Pages deploys from `nano-sandbox` `main` (static `out/` / `public/`).  
Render **nano-sandbox-api** auto-deploys `backend/` on **commit to main**.

---

## 3. Render dashboard — which service is which

Owner has **two nano-*** services plus CausalRail. Mixing them caused hours of
outage.

| Service | Runtime | Region | Status last seen | USE? |
|---|---|---|---|---|
| **nano-sandbox-api** | Python 3 | Oregon | Deployed / Live | **YES. This is the API.** |
| **nano-sandbox** | Node | Ohio | Failed deploy (5+ days) | **NO.** Leftover Next.js. Suspend/delete. |
| **causalrail-api** | Node | (separate) | Live `c337cd3` | **NO for this product.** URL `https://causalrail-api.onrender.com` |

**nano-sandbox-api settings (confirmed working):**

| Box | Value |
|---|---|
| Branch | `main` |
| Auto-Deploy | **On commit** (not “after CI checks pass”) |
| Build source | Native / GitHub `dominiccalandro1991-byte/nano-sandbox` |
| **Root Directory** | `backend` |
| Runtime | Python 3 (hidden after create — already Python, do not hunt for the box) |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| PORT env | **`10000`** (not 1000) |

Render service id last seen: `srv-d9vbtuh42hec738ljuog`  
Primary URL: `https://nano-sandbox-api.onrender.com`

**Do not** fill Node `npm run build` / `npm run start` on this API.

---

## 4. Supabase (the only DB for this product)

| | |
|---|---|
| Project ref | **`sujvxxrwjqsziswuazwm`** |
| Host style | Session **pooler** URI (IPv4). Not Direct. Not the old CausalRail project. |
| Region in `.env.example` | `aws-0-us-west-2.pooler.supabase.com` port **6543** |
| Schemas created at boot | `project_nano_sandbox`, `project_nano_cloud` |
| SQL in repo | `backend/sql/001_project_nano_sandbox.sql`, `backend/sql/002_rls.sql` |

**URI shape (password is ONLY in Render — never commit it):**

```
postgresql://postgres.sujvxxrwjqsziswuazwm:PASSWORD@aws-0-us-west-2.pooler.supabase.com:6543/postgres
```

Code rewrites `postgresql://` → `postgresql+psycopg://` (psycopg v3).  
See `backend/app/config.py` `normalize_database_url`.

**DEAD project — never use again:**

`hlwqtlrkwhuogcwnhjrs` (old CausalRail east-2). Putting that URI on
nano-sandbox-api was a prior outage.

Owner reset the DB password on 2026-08-21. Whatever is in Render **now** is the
live password. Do not reuse passwords that appeared in older chat screenshots.

---

## 5. Environment variables

### 5.1 Live on nano-sandbox-api (Render → Environment)

| Key | Required | Notes |
|---|---|---|
| `NANO_SANDBOX_DATABASE_URL` | **YES** | Session-pooler URI, **no spaces**, must start `postgresql://postgres.sujvxxrwjqsziswuazwm:` |
| `OPENROUTER_API_KEY` | **YES** | `sk-or-v1-…` for chat. Also accepted as `NANO_SANDBOX_OPENROUTER_API_KEY` |
| `PORT` | yes (Render default) | **`10000`** |

### 5.2 Recommended, may be missing

| Key | Why |
|---|---|
| `NANO_SANDBOX_KMS_SEED` | Long random string. JWT + wrapped user API keys. Dev default exists in code — not for real accounts. |

### 5.3 Optional — do not add unless needed

| Key | Why |
|---|---|
| `HF_TOKEN` | Hugging Face image fallback. Pollinations works with no key. |
| `GITHUB_TOKEN` | ProofPatch clone of **private** repos only. Public nano-sandbox does not need it. |
| `NANO_SANDBOX_OIDC_*` | Unused enterprise login. |
| `DATABASE_URL` | Duplicate; skip if `NANO_SANDBOX_DATABASE_URL` is set. |
| `LOVABLE_API_KEY` | **Do not put on nano-sandbox.** That is Lovable’s gateway. Dies if they leave Lovable. |
| `OPENAI_API_KEY` | Only if/when wiring GPT-Image-2. **Not set. Not free.** |

### 5.4 Secrets policy for the next agent

**Do not write live tokens, PATs, or passwords into git, HANDOFF, README, or chat
transcripts that get committed.**

They live in:

1. Render → nano-sandbox-api → Environment  
2. Owner’s OpenRouter dashboard  
3. Owner’s Supabase dashboard (reset password if leaked)

A GitHub PAT was used to push this repo from the agent sandbox. It must **not**
be pasted into this file. If a PAT was ever committed or put in `git remote -v`,
**rotate it** on GitHub.

OpenRouter key and DB password were shown in phone screenshots during setup.
Treat them as **possibly leaked**; rotate if this repo is public.

---

## 6. Architecture (how the pieces connect)

```
Phone/Desktop browser
  → GitHub Pages  (public/nnacc-v2/* copied to Pages)
  → fetch https://nano-sandbox-api.onrender.com
       → OpenRouter   (chat models, free tier)
       → DuckDuckGo   (POST /search)
       → Pollinations (GET  /media/image)
       → Supabase pooler (workspace, auth, RLS)
       → ProofPatch isolated git clone + pytest/node --check
```

Frontend is **static JS** (not the leftover Next.js `package.json` at repo root).
That root `package.json` (`next dev` / `next start`) is why the **Node** Render
service exists and fails. Ignore it for deploys.

Pages UI loads scripts from `public/nnacc-v2/js/*.js`.

---

## 7. Outages we already paid for (do not repeat)

| Symptom | Actual cause | Fix already in code / ops |
|---|---|---|
| Render Node “Failed deploy” | Wrong service, `npm start` on this repo | Ignore/delete **nano-sandbox** Node service |
| `workspace_db not initialized` 503 | Init exception swallowed; `/health` still 200 | Look for `workspace_db init failed` in **boot** logs |
| `No module named 'psycopg2'` | Pydantic passed raw `postgresql://`; SQLAlchemy wanted psycopg2 | `cb40939` rewrites to `postgresql+psycopg://` |
| 500 after driver fix | Pooler prepared statements + RLS vs `postgres.*` role | `78e9b1e` `prepare_threshold=None`, SSL, `current_user LIKE 'postgres%'` |
| `ECIRCUITBREAKER too many authentication failures` | Wrong DB password / space after `:` / old `hlwqt…` URI | Reset Supabase password; paste **sujvxx…** session-pooler URI once; wait ~10 min; do not hammer |
| URI “looked right” but was CausalRail | `postgres.hlwqtlrkwhuogcwnhjrs` + space in password | Only `sujvxxrwjqsziswuazwm` |
| Env value = the **name** of the var | Screenshot showed VALUE `NANO_SANDBOX_DATAB…` | Value must be `postgresql://…` |
| CausalRail screenshot “it’s working” | Different app, `https://causalrail-api.onrender.com/health` `db:true` | Do not copy that URI |

**How to debug DB next time:**  
Render **nano-sandbox-api** logs at **process start**, not request logs:

```
workspace_db init failed: …
vault_db init failed (scheme=…): …
```

Then `GET /workspace/projects` once. Want `{"projects":[]}`.

---

## 8. Frontend map (`public/nnacc-v2/`)

| File | Job |
|---|---|
| `index.html` | Shell: icon-rail, sidebar, empty-hero, composer, settings, share modal |
| `css/styles.css` | Layout, history-rail, mobile drawer, composer. **Phone hides model `<select>`** (`@media max-width:768px .composer-model{display:none}`) |
| `js/ui-controller.js` | Views, messages, fills `#model-select` / `#persona-select` |
| `js/chat-partition.js` | Streaming LLM chat via `/llm/chat` |
| `js/chat-screen.js` | Block A: temporary chat, share, thumbs, regenerate |
| `js/session-engine.js` | localStorage sessions; haystack/preview/tools/pinned. `PREFIX = "nnacc_session_"` |
| `js/history-rail.js` | Search, pin, rename, delete, date groups, archive/project filters |
| `js/shell-layout.js` | Icon-rail, labs toggle, empty-hero, settings tabs |
| `js/composer-bar.js` | +, mic/waveform, search, Pollinations image, chips |
| `js/recent-files.js` | Recent files rail |
| `js/workspace-client.js` | Folders/threads ↔ `/workspace/*` |
| `js/account.js` | Register/login, traits/memory, encrypted API key |
| `js/shortcuts.js` | Keyboard shortcuts |
| `js/proofpatch.js` | ProofPatch UI |
| `js/icons.js` | Lucide-style SVG paths |

**Engine files — DO NOT REBUILD:**

- `js/virtual-stress-engine.js` + `js/virtual-stress-ui.js`
- `js/usse-bridge.js`
- `js/aegis-engine.js`
- `js/vault-engine.js`
- `js/studio-engine.js`
- `js/debug-security-engine.js`
- `js/engine-chat.js`
- `js/macro-engine-ui.js`
- `js/codegen-utils.js`
- backend `app/nase/*`, `app/orchestrator/*`, `app/routers/nase.py`, `app/routers/validators.py`, `app/routers/jobs.py`

`public/platform/index.html` loads the **same** unified app (relative paths to nnacc-v2).

---

## 9. Backend map (`backend/`)

| File | Job |
|---|---|
| `app/main.py` | FastAPI app; init vault + workspace; CORS `*` |
| `app/config.py` | Settings; `normalize_database_url`; OpenRouter key resolve |
| `app/workspace_db.py` | projects/threads/profiles/user_settings; pooler connect_args |
| `app/rls.py` | ENABLE RLS + policies; service bypass `current_user LIKE 'postgres%'` |
| `app/auth.py` | JWT register/login |
| `app/proofpatch.py` | Isolated git clone/apply, pytest / node --check, 3 attempts, scrub env |
| `app/routers/health.py` | `GET /health` (does **not** report DB) |
| `app/routers/openrouter_llm.py` | `/llm/models`, `/llm/chat` |
| `app/routers/search.py` | DuckDuckGo |
| `app/routers/media.py` | Pollinations (+ optional HF) |
| `app/routers/workspace.py` | folders/threads |
| `app/routers/auth.py` | register/login |
| `app/routers/shares.py` | in-memory share snapshots |
| `app/routers/proofpatch.py` | `/proofpatch/verify`, `/proofpatch/health` |
| `app/nase/` | Vault, KMS, OIDC, attestation — **do not rewrite** |
| `tests/test_db_url.py` | URL rewrite |
| `tests/test_proofpatch.py` | ProofPatch |

Start locally: `cd backend && uvicorn app.main:app --reload --port 8000`

---

## 10. Protocol blocks (all implemented on `main`)

From `NANO_SANDBOX_ARCHITECTURE_AND_REMEDIATION_PROTOCOL.md` (workspace
`attachments/` copy). $0 OPEX: LiteLLM/OpenRouter free models, Pollinations,
DDGS, one Supabase project.

| Block | Commit | What shipped |
|---|---|---|
| **A** | `dfe0d86` | Empty hero, temporary chat (no persist), share snapshot, thumbs, regenerate |
| **B** | `ce593cf` | Search, screen/camera, voice waveform, recents, Pollinations |
| **C** | `d98e67e` | Lucide icons, folders, archive, global search, delete |
| **D** | `74c0811` | Account/JWT, vaulted API key, memory, shortcuts, traits |
| **E** | `ff980e6` | ProofPatch, RLS, scrub `hlwqt…` URLs. Engines untouched |

Follow-up commits (must stay):

- `cb40939` psycopg3 URL rewrite  
- `78e9b1e` pooler + RLS service role  

---

## 11. Composer / models / images (current live behavior)

**Model picker exists:** `#model-select` in the composer. Filled from
`ChatPartition.FREE_MODELS` / `GET /llm/models`.

**On phones (<768px) it is CSS `display:none`.** Owner is usually on iPhone, so
it looks “missing.” Desktop shows it. Persona `#persona-select` is in the
toolbar above the thread.

Live model groups (API 200):

- Coding Pro (Free) — 3 models (e.g. poolside/laguna-*:free)  
- General Chat & Reasoning (Free) — 3 models  

**Images today:** `+` → **Generate image** → `GET /media/image` → Pollinations.
Owner tested “planets fighting”; result was lens-flare / sun blob. **Pipeline
worked; Pollinations prompt-follow is weak.** Not a 404.

Empty-hero chip **Create image / canvas** also routes toward studio/image.

---

## 12. Dream Canvas Pro (Lovable) — checked, NOT integrated

Repo: https://github.com/dominiccalandro1991-byte/dream-canvas-pro-8d31b443  

Lovable project name: **Dream Canvas Pro**  
Export path that worked: Connectors → GitHub API → **Sync my code** (not
“Use the connector”). Empty GitHub repo (no README).

It is **not local GPT-2**. Server route:

- `src/routes/api/generate-image.ts`  
- `POST https://ai.gateway.lovable.dev/v1/images/generations`  
- model `openai/gpt-image-2`  
- auth `LOVABLE_API_KEY`  

Same for `edit-image.ts` (`/v1/images/edits`). UI has upscale, variations,
IndexedDB gallery `gpt2-images`.

**Leaving Lovable kills that model** unless owner adds a paid **OpenAI** key.
Owner decided **not** to launch a paid image SaaS today (OpenAI needs a card;
Stripe takes a cut after first sale; App Store is $99/yr).  

**Current product stays $0 images (Pollinations).** GPT-Image-2 is a **future**
optional path: OpenAI key on Render → new media route → composer `+` image.
Do not put `LOVABLE_API_KEY` on nano-sandbox-api.

iPhone “Add to Home Screen” of the Lovable app is **only a bookmark**. It has
no source.

---

## 13. Payments / native app (decision already made)

Owner asked about charging for images / subscriptions / App Store **today**.
Answer given:

- Stripe: $0 to open, % cut **after** a customer pays.  
- GPT-Image-2: **not** $0 — OpenAI card required before first image.  
- Website first (already live). PWA/home-screen later. Native app last.  
- **Do not advertise a paid image product until OpenAI is funded.**

Do not start Stripe unless owner explicitly says **wire Stripe**.

---

## 14. CausalRail (separate — only so you don’t confuse it)

| | |
|---|---|
| Repo | https://github.com/dominiccalandro1991-byte/causalrail.git |
| API | https://causalrail-api.onrender.com |
| Health (verified) | `{"ok":true,"db":true,"configured":true,"dbError":null}` |
| Last seen live commit | `c337cd3` “Harden Render DB + ship live dashboard to Pa…” Aug 20 7:22 AM |
| Stack | React/Vite client + Node Express server (also a Next leftover in *this* Grok `/workspace`) |
| Webhook secret name | `GITHUB_WEBHOOK_SECRET` (value lives on CausalRail Render only) |

This Grok **workspace** (`/workspace`) still contains CausalRail Next.js UI
(`src/lib/causalrail/*`, `src/routes/api/webhooks/github.ts`) from an earlier
App Builder session. **The production Voltage Cipher app is GitHub
`nano-sandbox`, not this workspace’s Vite preview.**

When working Voltage Cipher: clone/push **nano-sandbox**. Do not deploy this
workspace to the Node Render service.

---

## 15. How the next agent should work

1. Read **this file**.  
2. Clone `https://github.com/dominiccalandro1991-byte/nano-sandbox` if not already.  
3. `curl` live `/health` and `/workspace/projects` before changing DB/env code.  
4. **Do not touch engine files** listed in §8.  
5. UI changes: `public/nnacc-v2/` then copy to Pages `out/` the same way prior
   commits did; push `main`; GitHub Pages + Render auto-deploy.  
6. API changes: `backend/` only; Render **On commit**.  
7. Never ask the owner to “just set Runtime to Node.”  
8. Never put secrets in git.  
9. Owner is usually on **iPhone**. Mobile CSS matters (sidebar drawer, hidden
   model select, 44px targets).  
10. If owner says “is it working?”, hit the live URLs. Screenshots of CausalRail
    or Lovable are not nano-sandbox-api.

---

## 16. Suggested first verification (copy-paste)

```bash
BASE=https://nano-sandbox-api.onrender.com
curl -sS -m 40 "$BASE/health"
curl -sS -m 40 "$BASE/workspace/projects"   # want {"projects":[]}
curl -sS -m 40 "$BASE/proofpatch/health"
curl -sS -m 40 "$BASE/llm/models"
curl -sS -m 40 "$BASE/media/image?prompt=test"
curl -sS -m 20 -o /dev/null -w '%{http_code}' \
  https://dominiccalandro1991-byte.github.io/nano-sandbox/
```

---

## 17. Open / next (owner has not ordered these yet)

- Unhide `#model-select` on mobile if they want the picker on iPhone.  
- Improve Pollinations prompts (or optional HF FLUX) — quality only.  
- Wire GPT-Image-2 **only** after an OpenAI key exists.  
- Stripe / subscriptions — **not started, not requested as build yet**.  
- Native iOS/Android — **do not start**. Website is the product.  
- Rotate leaked PAT / OpenRouter / old DB passwords.  
- Suspend Render service **nano-sandbox** (Node, failed).  
- Set `NANO_SANDBOX_KMS_SEED` on Render for real accounts.

---

## 18. User / agent working style (so you don’t fight them)

- They work from a **phone**, Render + Supabase + Lovable dashboards.  
- Give **exact box labels and paste values**, not essays.  
- They will paste screenshots; believe live `curl` over a screenshot of a
  *different* service.  
- They will say “say it worked”; only say that when the live URL matches.  
- Engines are sacred. Chat/history/settings/composer are the flexible surface.  
- “One live URL” = GitHub Pages nano-sandbox. API is the Render Python service.

---

## 19. Protocol file location

Full original Block A–E spec:

- Workspace: `/workspace/attachments/NANO_SANDBOX_ARCHITECTURE_AND_REMEDIATION_PROTOCOL.md`  
- Also referenced in prior chat as uploaded `NANO_SANDBOX_ARCHITECTURE_AND_REMEDIATION_PROTOCOL.md`

Render web-services spec they attached:

- `/workspace/attachments/1.0 render_web_services_specification.md`

---

## 20. One-paragraph status for the next human/agent

Voltage Cipher Studio is **live**. Pages UI + FastAPI + Supabase
`sujvxxrwjqsziswuazwm` connected (`{"projects":[]}`). Blocks A–E are on `main`
(`78e9b1e`). Chat/search/Pollinations/ProofPatch/engines work. Phone hides the
model dropdown. Dream Canvas Pro is exported to GitHub but still Lovable-billed
GPT-Image-2 — **not** in this app. CausalRail is a **different** live API. Do
not mix databases. Do not rebuild engines. Do not commit secrets.
