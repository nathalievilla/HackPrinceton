# AGENTS.md

Authoritative architecture + safety contract for **AI agents (Cursor, Claude Code, etc.) and humans** working in this repo. If a future change conflicts with this file, stop and update this file in the same PR.

Repo layout:

```
HackPrinceton/
  backend/          Express API + R orchestration (this is the agent surface)
  hack-princeton/   React (Vite) frontend
  AGENTS.md         <- you are here
  README.md
```

## 1. What this product does

User uploads a clinical-trial CSV. The backend:

1. Validates the upload.
2. Asks an LLM to **propose** an analysis plan and corresponding R code.
3. **Executes** the R code in a sandboxed subprocess.
4. **Validates** the R output against a fixed schema.
5. Asks a **second LLM call (manager check)** to flag anything suspicious.
6. Persists the analysis + manager report for React to render.

Two audiences for the same output:

- **Non-statistician** (medical director, regulator) -> headline + plain-English summary.
- **Statistician** -> stage timeline, raw metrics, manager-check flags, R execution metadata.

## 2. Canonical API contract (DO NOT silently break)

Backend lives in [`backend/server.js`](backend/server.js). Routes:

| Method | Path                | Purpose                                    |
| ------ | ------------------- | ------------------------------------------ |
| GET    | `/health`           | liveness + R runtime + LLM provider status |
| POST   | `/upload`           | multipart `file=<csv>`, returns `{ job_id, status: "queued" }` |
| GET    | `/jobs/:job_id`     | full job state (React polls this)          |
| GET    | `/results/:job_id`  | analysis JSON + summary                    |
| GET    | `/report/:job_id`   | final report (analysis + manager check)    |

Deprecated but currently supported (used by older clients):

- `GET /results?job_id=...`
- `POST /interpret`

Rules for changing routes:

- Renaming or removing any route above requires (a) coordinating with the frontend owner of [`hack-princeton/`](hack-princeton/) so the React client is updated in the same PR, (b) updating this file, (c) keeping the old route as a deprecated shim for at least one PR.
- Adding new routes is free as long as it does not change behavior of the routes above.

## 3. Job state schema (DO NOT rename fields)

Defined in [`backend/src/jobs.js`](backend/src/jobs.js). React polling and the timeline UI render directly off these fields:

- `job_id: string`
- `status: "queued" | "running" | "completed" | "failed"`
- `stage: <one of jobs.STAGES>`
- `progress: 0-100`
- `created_at`, `updated_at`, `completed_at` (ISO 8601)
- `uploaded_file: { name, path, size }`
- `stages: [{ name, status, started_at, finished_at, message }]`
- `artifacts: { r_script_path, r_output_path, report_path }`
- `error: { stage, message, details } | null`

Stage order is fixed (see `STAGES` in `jobs.js`). Adding a stage requires updating `STAGES`, the pipeline, and the README so React can render it without code changes.

## 4. Required output schema from R

Validated in [`backend/src/validators.js`](backend/src/validators.js) by `validateRRunOutput`. Top-level keys MUST exist:

- `shap: { features: string[], importance: number[] }`
- `survival: { time_points: number[], curves: { [name]: number[] } }`
- `subgroups: [{ name, size, response_rate, baseline_rate }]`

Adding optional keys is fine. Removing or renaming any of these breaks the React renderer (owned by the frontend teammate in [`hack-princeton/`](hack-princeton/)) and the manager check in [`backend/src/llm.js`](backend/src/llm.js). Coordinate with the frontend owner before changing this schema.

## 5. Module boundaries (do not bypass)

```
server.js
  -> src/jobs.js        (state machine; only place jobs are mutated)
  -> src/pipeline.js    (orchestration)
       -> src/llm.js    (every AI call goes here)
       -> src/runner.js (every R subprocess goes here)
       -> src/validators.js
```

Hard rules:

- Routes in `server.js` MUST NOT call R, the LLM, or the filesystem directly for analysis logic. They wire HTTP to `pipeline.runPipeline` and read persisted artifacts.
- The pipeline MUST update job state via `jobs.startStage` / `finishStage` / `failStage` so the polling endpoint always reflects reality.
- All R execution MUST go through `runner.runRScript` / `runner.runGeneratedRScript`. These enforce the timeout, the per-job working directory, and stdout/stderr capture.
- All LLM calls MUST go through `llm.js`. Every function in `llm.js` MUST return a deterministic fallback so the demo works without API keys.

## 6. Safety guardrails

- **Timeouts.** Every R subprocess has a hard timeout (`R_TIMEOUT_MS`, default 60s). Do not introduce long-running tasks without a timeout.
- **Sandbox dir.** Generated R code is written under `backend/runtime/<job_id>/`. R reads the uploaded CSV path it is given and writes JSON only to its second arg. Do not allow generated code to touch other paths.
- **Bounded retries.** AI-driven code generation retries at most `MAX_R_RETRIES + 1` times in [`backend/src/pipeline.js`](backend/src/pipeline.js). Do not raise this without justification.
- **Structured errors.** Failures must populate `job.error = { stage, message, details }`. No opaque 500s with empty bodies.
- **Secrets.** Never commit `.env`. Only `.env.example` is tracked. Do not log secret values.
- **R fallback.** If `Rscript` is unavailable or `USE_R=false`, the runner returns a synthetic result so the demo still works. Mark the result as `synthetic: true` so the UI can show a banner.
- **LLM fallback.** Same idea for the AI layer. `LLM_PROVIDER=fallback` is the safe default; deterministic plain-English summaries and rule-based manager checks still run.

## 7. Things you are NOT allowed to do as an agent without explicit human sign-off

- Rename or remove a route in section 2.
- Rename or remove a field in section 3 or 4.
- Remove the deterministic fallbacks in `llm.js` or `runner.js`.
- Add a new dependency that requires a paid API key as the only path.
- Run shell commands that modify files outside this repo, push to remote, or amend other people's commits.
- Commit anything under `backend/uploads/`, `backend/results/`, `backend/runtime/`, or any `.env*` (except `.env.example`).

## 8. Pre-change checklist for any agent edit

Before opening a PR:

1. Did this change touch a route, stage name, or output key listed above? If yes, update this file in the same PR and update both the backend module and the React side.
2. Did this change introduce a subprocess or external call? If yes, ensure timeout + structured error path.
3. Did this change introduce a secret? If yes, add it to `backend/.env.example` (placeholder only) and reference it via `process.env`.
4. Does `npm start` from `backend/` still print `r_runtime` and `llm_provider` lines without crashing when (a) R is installed and (b) R is not installed?
5. Does `GET /health` still return `{ ok: true, ... }`?

## 9. Where to start reading

If you are new (human or agent), read in this order:

1. [`AGENTS.md`](AGENTS.md) (this file) – the contract.
2. [`backend/README.md`](backend/README.md) – how to run + Postman/curl recipes.
3. [`backend/server.js`](backend/server.js) – routes only, ~150 lines.
4. [`backend/src/jobs.js`](backend/src/jobs.js) – state machine.
5. [`backend/src/pipeline.js`](backend/src/pipeline.js) – the orchestration story.
6. [`backend/src/runner.js`](backend/src/runner.js) – Node ↔ R boundary.
7. [`backend/r/analyze.R`](backend/r/analyze.R) – baseline R analysis.
8. [`hack-princeton/`](hack-princeton/) – React surface, owned by the frontend teammate. The backend contract above is the only thing this side relies on.
