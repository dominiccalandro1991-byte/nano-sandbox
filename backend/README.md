# backend/ -- nano-sandbox remote validation engine

An **optional** FastAPI service. The NanoHabitat Sandbox Engine (NHSE) that
lives in the rest of this repo runs entirely on-device and never needs this
to exist. When you configure a URL in NHSE's **Remote** tab, NHSE will call
out here for validation jobs that are too heavy, too long-running, or
require running arbitrary code outside a browser tab.

## Run it locally

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Then point NHSE's Remote tab at `http://localhost:8000`.

## Run the tests

```bash
cd backend
source .venv/bin/activate
pytest -v
```

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Liveness + version. |
| GET | `/validators` | Lists every registered validator: id, description, payload schema. |
| POST | `/jobs` | Submits a job, runs it synchronously inside the sandbox, returns the completed `Job`. |
| GET | `/jobs?limit=N` | Recent jobs, most recent first. |
| GET | `/jobs/{id}` | A single job by id. |

`POST /jobs` body:
```json
{
  "validator_id": "soft-body-physics",
  "payload": { "rows": 4, "cols": 4, "steps": 300 },
  "seed": 9,
  "label": "optional human-readable name"
}
```

## Registered validators

| id | What it checks | Domain data status |
|---|---|---|
| `soft-body-physics` | Runs a mass-spring soft-body simulation; fails on non-finite/exploding state, and (with gravity off) on total mechanical energy increasing under damping -- a real physics invariant, not a tuned threshold. | Self-contained math, no external domain data. |
| `multi-agent-interaction` | Runs a seek+separation multi-agent sim twice; fails if the replay isn't bit-identical, an agent leaves the arena, or too few agents converge to target. | Self-contained math, no external domain data. |
| `tcc-anomaly` (Topological Component Anomaly) | Diffs an observed feature grid against a baseline grid, smooths it, and flags local maxima above threshold as anomaly coordinates. | **Placeholder.** The anomaly-type labels (`structural_fracture`, `component_burn`, etc.) are an illustrative heuristic based on the diff's local gradient shape, not a trained or calibrated classifier. Do not treat a label from this validator as a real diagnosis. |
| `cdem-diagnosis` (Causal Diagnostic Entropy Minimizer) | Bayesian posterior update over a small set of example failure-mode hypotheses, fusing visual/audio/text evidence; reports Shannon entropy and confidence. | **Placeholder.** The failure modes and their visual/acoustic likelihood tables in `app/validators/cdem_data.py` are illustrative examples (e.g. "capacitor hum ~120Hz"), not sourced from real component acoustic signatures. The Bayes/entropy math is real and tested; the domain priors are not calibrated to anything. |
| `rte-repair-plan` (Repair Trajectory Engine) | Dijkstra-optimal path over a repair-template graph, weighted by time/skill/risk; gates `is_safe_for_user` against the requester's skill level. | **Placeholder.** The example repair graph in `app/validators/rte_data.py`, including every `pinout_voltage_check` value, is synthetic demonstration data. **These are not real voltage specs for any real device. Do not use this validator's output to guide actual hands-on electrical repair.** The pathfinding/safety-gating algorithm is real and tested; only the graph contents are fake. |

See `Diagnostic_Engines_Technical_Spec.md`'s coverage in `AI_HANDOFF.md` for
the full reasoning on why the diagnostic-suite domain data is placeholder
rather than populated with anything that looks authoritative.

## Adding a new validator

1. Create `app/validators/<name>.py` implementing the `Validator` protocol
   in `app/validators/base.py` (an `id`, a `description`, a `payload_schema()`,
   and a pure `run(payload, seed) -> ValidationReport`).
2. Register an instance in `app/validators/__init__.py`'s `REGISTRY`.
3. Add unit tests in `tests/test_validators.py`.

Routers, the sandbox runner, and the job store never need to change --
that's the entire extension surface by design.

## Deploying

There's no Dockerfile or hosting config checked in yet -- this has only
been run locally / in-sandbox so far. Any standard ASGI host (Railway,
Render, Fly.io, a VPS with `uvicorn`/`gunicorn`) works; set
`NANO_SANDBOX_CORS_ALLOW_ORIGINS` to your actual NHSE origin instead of the
default `*` once you have one, and put the deployed URL into NHSE's Remote
tab. See `app/config.py` for every environment variable this service reads.

## Isolation model -- read this before relying on it for untrusted code

Each job runs in its own subprocess with a wall-clock timeout and (POSIX)
memory/CPU rlimits, so a runaway or crashing validator can't take the API
process down. **This is not a security sandbox against hostile code** -- a
validator that calls `os.system(...)` still runs with this process's OS
permissions. All validators registered today are trusted code you wrote,
not user-submitted code. If nano-sandbox ever needs to execute
agent-authored code rather than fixed validators evaluating agent-authored
*data*, swap `app/orchestrator/sandbox.py` for a real container/VM boundary
first.
