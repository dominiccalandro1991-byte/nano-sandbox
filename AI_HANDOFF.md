# AI_HANDOFF.md

Running ledger for nano-sandbox. Update this instead of relying on chat
history -- anyone (human or AI) picking this up should be able to read this
file plus the two READMEs and know exactly where things stand.

---

## Session 1 -- repo audit + remote engine scaffold

**Found:** the repo was not empty. It already contained a working,
single-commit, v0.app-generated Next.js app: the NanoHabitat Sandbox Engine
(NHSE) -- a content-addressed store, working-set governor, live module
runtime, predictor, architecture graph, snapshot export/import, and a
60-case embedded self-test suite. It runs entirely client-side, in iOS
Safari, with no backend.

**Built:**
- `backend/` -- a new, optional FastAPI remote validation engine:
  - `app/validators/base.py` -- pure `Validator` protocol (payload, seed) -> `ValidationReport`.
  - `app/validators/soft_body_physics.py` -- real mass-spring soft-body sim; fails on non-finite/exploding state or (gravity off) increasing mechanical energy under damping.
  - `app/validators/multi_agent_interaction.py` -- real seek+separation multi-agent sim; fails on non-determinism (replay hash mismatch), out-of-bounds agents, or insufficient convergence.
  - `app/orchestrator/sandbox.py` -- process-isolated runner: wall-clock timeout + POSIX memory/CPU rlimits. Explicitly documented as *not* a security boundary against hostile code (see backend/README.md).
  - `app/orchestrator/jobs.py` -- in-memory job store (deliberately not a DB -- see module docstring for why and what to swap in later).
  - `app/routers/` -- `/health`, `/validators`, `/jobs`.
  - `tests/` -- 18 pytest cases covering validators, sandbox (including a real timeout case and an unknown-validator case), and the API via `TestClient`.
- `components/nhse/remote-view.tsx` + `lib/nhse/remote-client.ts` -- a new "Remote" tab in NHSE: configure a backend URL (persisted in `localStorage`), health-check it, list its validators, submit a job with a JSON payload editor, see the result and recent job history. Fully optional -- every other tab works identically with no URL configured.

**Verified (not just claimed):**
- `pytest -v` in `backend/`: **18/18 passed.**
- Booted `uvicorn` for real and hit `/health`, `/validators`, and `POST /jobs` over actual HTTP (not just the in-process `TestClient`) -- confirmed a real physics job ran and returned physically sane numbers (energy dropped from ~41.3 to ~0.99 under damping).
- `tsc --noEmit` clean on every file touched.
- `pnpm install` succeeded; `next build` fails **only** because this build sandbox's network allowlist blocks `fonts.googleapis.com`, which `app/layout.tsx` (pre-existing, not touched this session) calls via `next/font/google`. Not a code defect -- will build fine anywhere with normal internet access (Vercel, etc.). Not yet verified on a real host.

**Known defects at end of session 1:**
- `tsc --noEmit` had 6 pre-existing errors in `lib/nhse/engine.ts` and `lib/nhse/storage.ts`, present before this session touched anything.
- No root or backend README.
- No `AI_HANDOFF.md`.
- Nothing pushed -- only read access to the repo from this session; push needs either a token or manual delivery.

---

## Session 2 -- type cleanup, docs, tri-engine diagnostic suite

**Fixed:**
- `lib/nhse/engine.ts` -- `terms[0]` was typed `string | undefined` under indexed-access checking even though `terms.length === 0` is guarded two lines above; pinned it to a real `string` once (`firstTerm`) instead of asserting at the call site.
- `lib/nhse/storage.ts` -- both `createMemoryStorage()` and `createIdbStorage()` had methods with their own generic `<T>` (e.g. `get<T>(store, key)`), which breaks TypeScript's contextual typing from the `Storage` interface for the *other*, non-generic parameters -- `store`/`key`/`value`/`entries` were silently `any`. Added explicit parameter types on every method in both implementations.
- **Result: `tsc --noEmit` now reports zero errors, whole repo.** (Re-run this yourself to confirm -- don't take the ledger's word for it.)

**Added:**
- Root `README.md`, `backend/README.md` (this session).
- `backend/app/validators/tcc_validator.py`, `cdem_validator.py`, `rte_validator.py` -- see "Tri-engine diagnostic suite" section below for what these do and, importantly, what they don't.

### Tri-engine diagnostic suite -- what was built, and a direct flag on the domain data

You supplied `Diagnostic_Engines_Technical_Spec.md` describing three
validators (TCC / CDEM / RTE) for a hardware-repair diagnostic platform:
camera+audio+text in, failure diagnosis and step-by-step repair
instructions (including specific voltage checks) out.

**What I built as specified, for real:** the algorithms. Matrix diffing +
Gaussian smoothing + local-maxima detection (TCC); Bayesian posterior
update + Shannon entropy over a hypothesis set (CDEM); Dijkstra shortest-path
cost optimization over a weighted graph with skill/tool pruning and a
safety gate (RTE). These are genuine, tested implementations of real
algorithms -- not stubs.

**What I did not build as specified: the domain content.** The spec's
worked math (a "metric tensor divergence" over a Riemannian manifold; a
Bayesian network with acoustic failure signatures like "capacitor hum ~120Hz";
a repair-template graph with real `pinout_voltage_check` values) needs
actual reference data to mean anything -- golden-baseline component
scans, a real acoustic-signature library, and repair procedures sourced
from real datasheets/service manuals. I don't have that data, and I'm not
going to invent plausible-looking versions of it (a fake voltage check that
*looks* like a real one is the specific failure mode this project's own
standing rule -- "no fabricated verification" -- exists to prevent, and here
it's not just a hash claim, it's the kind of number someone could act on
with a multimeter). So:

- `tcc_validator.py`'s anomaly-type labels are a documented heuristic based
  on local diff-gradient shape, explicitly not a calibrated classifier.
- `cdem_validator.py`'s failure-mode hypotheses and their visual/acoustic
  likelihood tables (`cdem_data.py`) are a small illustrative example set,
  clearly marked as such in-file.
- `rte_validator.py`'s example repair graph (`rte_data.py`), including every
  voltage value in it, is synthetic placeholder data. **Do not use its
  output to guide real electrical repair work.**

The math is real and tested (see `tests/test_diagnostic_engines.py`). The
domain knowledge is a placeholder you'd need to replace with sourced data
before this suite means anything about a real device. This is called out
loudly here, in code docstrings, and in `backend/README.md` rather than
buried, on purpose.

**Architecture decision:** the spec proposed its own `BaseValidator`
(async `validate()`) / `ValidationResult` (`validator_name`,
`execution_time_ms`, `details: dict`) interface. That's a second,
incompatible contract from the `Validator`/`ValidationReport` interface the
rest of `backend/` (routers, sandbox, job store, `remote-client.ts`) already
runs on. Implemented TCC/CDEM/RTE against the existing contract instead of
introducing a parallel one -- that's what makes "register it and it just
shows up in `GET /validators`/`POST /jobs`" literally true with zero extra
plumbing. One real gap this exposed: the existing `ValidationReport` only
had flat `metrics: dict[str, float]`, with nowhere to put structured output
(anomaly coordinates, repair steps, hypothesis lists). Added an optional
`details: dict[str, Any]` field to `ValidationReport` to cover this --
backward compatible, the first two validators just leave it empty.

**Registered:** all three added to `app/validators/__init__.py`'s
`REGISTRY`, so `GET /validators` and `POST /jobs` expose them to NHSE's
Remote tab exactly like the first two validators.

**Verified:**
- `pytest -v` in `backend/`: **36/36 passed** (18 from session 1 + 18 new:
  5 TCC, 5 CDEM, 8 RTE). First full run actually caught 3 real failures --
  2 were bugs in my own new tests (an out-of-range `min_confidence` in a
  CDEM test, and an RTE test whose `available_tools` accidentally pruned
  the entire graph instead of just the branch it meant to test), and one
  was a real gap in the example RTE graph data: the risky branch's hazard
  (4) exactly tied the safe branch's total hazard (2+2=4), so no value of
  `lambda_risk` could ever route around it -- fixed by raising the risky
  branch to hazard 5 (still within the spec's 1-5 range), which makes the
  cost tradeoff actually testable. All three fixes and the re-run are in
  this session's transcript, not just asserted here.
- Booted `uvicorn` again and hit all 5 validators (including the 3 new
  ones) over real HTTP. Confirmed concretely: TCC located an injected
  spike at the exact coordinate it was placed; CDEM, given text symptoms
  "smells hot, tripped breaker", correctly posteriored onto
  `component_short` at ~72% with the entropy math checking out; RTE
  produced a real 4-step plan for an intermediate user, correctly pruning
  the expert-only risky branch, with every `pinout_voltage_check` null.
- `tsc --noEmit`: still zero errors, whole repo, after extending
  `ValidationReport` with a `details` field and wiring it through
  `remote-client.ts` and `remote-view.tsx`.

**Open defects at end of session 2:**
- Backend has no persistence beyond process memory (documented, deliberate
  for now -- see `app/orchestrator/jobs.py`).
- No CI / GitHub Actions merge gate yet.
- No Dockerfile or deploy config -- backend has only run locally/in-sandbox.
- `next build` still unverified on a real host with internet access (see
  Session 1 note -- this build sandbox can't reach Google Fonts).
- Nothing pushed to GitHub yet this session either.

---

## Session 3 -- reconcile fix/complete-nano-sandbox into main

You surfaced a branch, `fix/complete-nano-sandbox` (4 commits), that I'd
flagged but not yet looked at: a localStorage-first rework of `storage.ts`
(matches your usual cross-project storage standard better than the
original v0-generated async-IndexedDB-primary code), input sanitization
(`validation.ts`, new file), an IndexedDB open timeout guard, and some seed
content fixes -- overlapping the same two files (`engine.ts`, `storage.ts`)
session 2 fixed type errors in.

**Merged, not just fast-forwarded.** Two real conflicts in `storage.ts`
(both branches touched the same method signatures) -- resolved by keeping
session 2's explicit parameter types alongside the incoming
`persistent: boolean` field on each backend.

**Verification caught two real bugs in the incoming branch itself,** not
just merge noise:
- `seed.ts` had unescaped backticks inside an outer template literal that
  broke the file's parse entirely -- cascaded into ~35 `tsc` errors across
  the whole file. Restored the escaping (kept the branch's other content
  changes: improved wording, a correctly-restructured concatenation fix
  elsewhere in the same file).
- The new `createLocalStorage()` had the exact same implicit-any parameter
  pattern from session 2's `tsc` fixes (a method's own generic `<T>` breaks
  contextual typing for its other params). Same fix applied.

**Result:** `tsc --noEmit` clean, whole repo. `next build` reaches the same
and only pre-existing failure point as every prior session (blocked
`fonts.googleapis.com` in this build sandbox -- not a real defect).

**Flagged, deliberately not changed:** `createStorage()` now tries
localStorage *first* for every store, including `blobs`/`objects`/`habitats`
-- but the localStorage adapter's own docstring says it's only suitable for
small metadata. localStorage's quota (~5-10MB typical) is much smaller than
IndexedDB's; larger habitat content that worked fine under the old
IndexedDB-primary order could start hitting quota failures now. This is a
design choice from the incoming branch, not something introduced by the
merge -- not overridden unilaterally here. **Next session should either
confirm this tradeoff is intentional, or change `createStorage()`'s order
to try localStorage only for small/metadata stores and IndexedDB-first for
`blobs`/`habitats`.**

**Pushed:** `main` now includes both lines of work. `fix/complete-nano-sandbox`
branch still exists on GitHub, now fully merged in -- safe to delete
whenever, nothing on it is unmerged.

### For whoever (human or AI) picks this up next

1. Re-run `tsc --noEmit` (root) and `pytest -v` (in `backend/`, venv
   activated) yourself before trusting this document's claims.
2. If extending the diagnostic suite: replace `cdem_data.py`/`rte_data.py`
   placeholder tables with real sourced data before treating output as
   trustworthy, or keep it clearly labeled as illustrative if it stays
   example data.
3. Deploy `backend/` somewhere with real internet access before wiring a
   production NHSE Remote tab to it; local `uvicorn` is dev-only.
4. Decide the localStorage-vs-IndexedDB backend order question flagged
   above in Session 3 before this sees real habitat content of any size.

---

## Session 4 -- storage harden, 1-D validator guards, UI hubs, push

**Storage (P0):** Strengthened `createStorage()` degraded path. BINARY_STORES
(blobs/objects) are **never** routed to localStorage even when IndexedDB is
unavailable; they fall back to the in-memory backend. Meta stores can still
use localStorage. Hybrid `persistent` flag is now the AND of both backends.
No merge-conflict markers were present on main; the hybrid already existed
from prior work and was completed for the "never fall back" invariant.

**Validators:** `physics-qc-matrix` and `geometry-tolerance` now return a
clean `ValidationReport(error=...)` on 1-D / non-2-D inputs instead of
raising `AxisError` / `IndexError`. ndim==2 guard added immediately after
`np.asarray`.

**Frontend:** `shell.tsx` reorganized into three labeled hubs:
- Input / Upload (Habitats, Files, Search)
- Engine Control (Run, Remote, Verify)
- Results & Synthesis (Graph, Store)
Title updated to "Ultimate Fix-It". Remote tab remains the control surface
for all 20 registered diagnostic engines (including TCC/CDEM/RTE and the
Continuity + Optical + Thermal + Chemical suites + causal-fusion).

**Verification (re-run locally this session):**
- `npx tsc --noEmit` → zero errors
- `pytest tests/ -v` → 36/36 passed
- 20-engine smoke with empty payload → 20/20 no unhandled exceptions

**Pushed:** `b09f6bf` to `main`.

**Residual / next:**
- Live production URL: no Vercel project or deploy token in this environment.
  Connect the GitHub repo to Vercel (or any Next host) and deploy `main` for
  a public URL. Backend still requires a separate host (uvicorn / container)
  for the Remote tab to talk to the 20 engines.
- Domain data in `cdem_data.py` / `rte_data.py` remains illustrative (see
  Session 2); do not treat voltage/repair numbers as real.
- Next logical increment under Continuity Authorization: a Results & Synthesis
  view that consumes causal-fusion + RTE output into a single repair-tree +
  confidence dashboard, or source replacement of the placeholder domain tables.
