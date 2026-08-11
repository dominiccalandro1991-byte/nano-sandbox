# nano-sandbox

A personal sandbox for testing games, agents, and "all kinds of different
stuff" without hand-carrying prompts between separate AI chats/projects.
It's two independent pieces that are allowed to be used together or apart:

| Piece | What it is | Runs where |
|---|---|---|
| **NHSE** (this repo's root: `app/`, `components/`, `lib/`) | NanoHabitat Sandbox Engine -- a content-addressed store, live module runtime, and verification suite. Fully self-contained. | Entirely on-device, in the browser (iOS Safari included). No server required. |
| **backend/** | An *optional* remote validation engine (FastAPI). NHSE's "Remote" tab can call out to it for validation work too heavy or too unsafe to run in a browser tab. | Wherever you deploy it. Never called unless you set a URL in the Remote tab. |

If you never touch the Remote tab, `backend/` is inert -- nothing in NHSE
requires it to exist.

## Quick start (frontend / NHSE)

```bash
pnpm install
pnpm dev
```

Open the app, and use the tabs: Habitats, Files, Graph, Run, Search, Store,
Verify, Remote.

## Quick start (backend, optional)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Then in NHSE's **Remote** tab, set the engine URL to `http://localhost:8000`
(or wherever you deploy it) and hit save. See `backend/README.md` for the
API and how to add new validators.

## Status

See `AI_HANDOFF.md` for the current build state, what's verified, what's
still open, and what's placeholder data that must not be treated as real
before deploying anywhere it matters.

## Project layout

```
app/                      Next.js app router pages
components/nhse/          NHSE UI (Habitats, Files, Graph, Run, Search,
                           Store, Verify, Remote tabs)
lib/nhse/                 NHSE engine: content-addressed store, governor,
                           runtime, predictor, graph, snapshot, self-tests
backend/                  Optional remote FastAPI validation engine
  app/validators/         Pluggable validator implementations
  app/orchestrator/       Process-isolated sandbox runner + job store
  app/routers/            /health, /validators, /jobs
  tests/                  pytest suite (run with `pytest` from backend/)
```
