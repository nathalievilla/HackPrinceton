# AGENTS.md

Authoritative architecture + safety contract for **AI agents (Cursor, Claude Code, etc.) and humans** working in this repo. If a future change conflicts with this file, stop and update this file in the same PR.

Repo layout:

```
HackPrinceton/
  backend/          Express API + HF Gemma agents + R orchestration
  hack-princeton/   React (Vite) frontend
  AGENTS.md         <- you are here
  README.md
```

## 1. What this product does

User uploads a clinical-trial CSV. The backend runs a **two-agent pipeline**:

1. **Validate** the upload (file is a CSV, header has required columns).
2. **Persist** the upload row in Supabase.
3. **Agent 1 (Gemma biostatistician)** writes an R script for the dataset.
4. **Execute** the R script in a sandboxed subprocess with a hard timeout.
5. **QA** the output JSON against a fixed schema.
6. **Agent 2 (Gemma manager)** reviews the analysis and produces QC flags + a plain-English summary.
7. **Persist** Agent 1 output, Agent 1 R code, and Agent 2 output as **separate** Supabase columns (audit requirement).

Two audiences for the same output:

- **Non-statistician** (medical director, regulator) -> headline + plain-English summary.
- **Statistician** -> stage timeline, raw metrics, manager-check flags, R code, R execution metadata.

## 2. Canonical API contract (DO NOT silently break)

Backend lives in [`backend/server.js`](backend/server.js). Routes:

| Method | Path                | Purpose                                                              |
| ------ | ------------------- | -------------------------------------------------------------------- |
| GET    | `/health`           | liveness + R runtime + HF + Supabase status                          |
| POST   | `/upload`           | multipart `file=<csv>`. Validates columns. Returns `{ job_id, status: "queued" }`. 400 with structured `details[]` if columns are missing. |
| GET    | `/jobs/:job_id`     | full job state (React polls this)                                    |
| GET    | `/results`          | list of past analyses from Supabase                                  |
| GET    | `/results/:job_id`  | one full analysis (Agent 1 output + R code + execution + summary)    |
| GET    | `/report/:job_id`   | final report incl. manager check                                     |
| POST   | `/agent1`           | standalone Gemma biostatistician + R run (multipart CSV or JSON body) |
| POST   | `/agent2`           | standalone Gemma manager: body `{ agent1_output }` -> QC + summary    |
| GET    | `/trial-context`    | ACTG 175 metadata (TREKIDS stub)                                     |

Removed (do not re-add without a new design):

- `POST /interpret` -> superseded by Agent 2.
- `GET /results?job_id=...` -> superseded by `GET /results/:job_id`.

Rules for changing routes:

- Renaming or removing any route above requires (a) coordinating with the frontend owner of [`hack-princeton/`](hack-princeton/) so the React client is updated in the same PR, (b) updating this file, (c) keeping the old route as a deprecated shim for at least one PR.
- Adding new routes is free as long as it does not change behavior of the routes above.

## 3. Job state schema (DO NOT rename fields)

Defined in [`backend/src/jobs.js`](backend/src/jobs.js). React polling and any timeline UI render directly off these fields:

- `job_id: string`
- `status: "queued" | "running" | "completed" | "failed"`
- `stage: <one of jobs.STAGES>`
- `progress: 0-100`
- `created_at`, `updated_at`, `completed_at` (ISO 8601)
- `uploaded_file: { name, path, size }`
- `stages: [{ name, status, started_at, finished_at, message }]`
- `artifacts: { r_script_path, r_output_path, report_path }`
- `error: { stage, message, details } | null`

Stage order is fixed. Current `STAGES`:

```
uploaded -> agent1_planning -> qa_validation -> agent2_review -> completed
```

Adding a stage requires updating `STAGES`, the pipeline, and this file.

## 4. Required output schema from R (Agent 1 output)

Validated in [`backend/src/validators.js`](backend/src/validators.js) by `validateRRunOutput`. Top-level keys MUST exist:

- `shap: { features: string[], importance: number[] }`
- `survival: { time_points: number[], curves: { [name]: number[] } }`
- `subgroups: [{ name, size, response_rate, baseline_rate }]`

Adding optional keys is fine. Removing or renaming any of these breaks the React renderer and Agent 2's QC heuristics. Coordinate with the frontend owner before changing this schema.

## 5. Required input schema (CSV upload)

Validated in [`backend/src/validators.js`](backend/src/validators.js) by `validateCsvColumns`. The CSV header (case-insensitive) MUST contain:

- `age`
- `trt`
- `label`

This list MUST stay in sync with `REQUIRED_COLUMNS` in [`hack-princeton/src/Dashboard.jsx`](hack-princeton/src/Dashboard.jsx).

## 6. Module boundaries (do not bypass)

```
server.js
  -> src/jobs.js           (state machine; only place jobs are mutated)
  -> src/pipeline.js       (orchestration)
       -> src/agents.js    (every Gemma agent call goes here)
            -> src/hf.js   (every Hugging Face SDK call goes here)
            -> src/runner.js (every R subprocess goes here)
       -> src/validators.js
       -> src/db.js        (every Supabase call goes here)
  -> src/trialContext.js   (TREKIDS stub)
```

Hard rules:

- Routes in `server.js` MUST NOT call HF, R, or Supabase directly for analysis logic. They wire HTTP to `pipeline.runPipeline` (or `agents.runAgent1` / `agents.runAgent2` for the standalone routes) and read persisted artifacts.
- The pipeline MUST update job state via `jobs.startStage` / `finishStage` / `failStage` so the polling endpoint always reflects reality.
- All R execution MUST go through `runner.runRScript` / `runner.runGeneratedRScript`. These enforce the timeout, the per-job working directory, and stdout/stderr capture.
- All Hugging Face calls MUST go through `hf.callGemma`. Every function that depends on it MUST have a deterministic fallback so the demo works without `HF_TOKEN`.
- All Supabase access MUST go through `db.js`. `db.js` MUST tolerate missing config (no-op + warning) so the demo works without Supabase.

## 7. Safety guardrails

- **Timeouts.** Every R subprocess has a hard timeout (`R_TIMEOUT_MS`, default 60s). Every HF call has a hard timeout (`HF_TIMEOUT_MS`, default 60s) plus 1 retry on 503.
- **Sandbox dir.** Generated R code is written under `backend/runtime/<job_id>/`. R reads the uploaded CSV path it is given and writes JSON only to its second arg. Do not allow generated code to touch other paths.
- **R-script validation.** Agent 1 output is regex-checked before execution: must contain `commandArgs(` and a JSON write call. If validation fails, the pipeline falls back to `r/analyze_fallback.R`.
- **Bounded retries.** If Agent 1's generated R fails to execute, the pipeline retries once with the deterministic fallback script.
- **Structured errors.** Failures must populate `job.error = { stage, message, details }`. No opaque 500s with empty bodies. `/upload` returns 400 with `{ error, required, details, columns_found }` when columns are missing.
- **Secrets.** Never commit `.env`. Only `.env.example` is tracked. Do not log secret values.
- **R fallback.** If `Rscript` is unavailable or `USE_R=false`, the runner returns a synthetic result so the demo still works. Mark the result as `synthetic: true` in `execution`.
- **HF fallback.** If `HF_TOKEN` is missing or HF is down, agents fall back to deterministic templates (rule-based subgroup highlight + heuristic QC).
- **Supabase fallback.** If Supabase is not configured, persistence is skipped silently and the API still returns results from disk.

## 8. Things you are NOT allowed to do as an agent without explicit human sign-off

- Rename or remove a route in section 2.
- Rename or remove a field in section 3, 4, or 5.
- Remove the deterministic fallbacks in `hf.js`, `agents.js`, `runner.js`, or `db.js`.
- Add a new dependency that requires a paid API key as the only path.
- Run shell commands that modify files outside this repo, push to remote, or amend other people's commits.
- Commit anything under `backend/uploads/`, `backend/results/`, `backend/runtime/`, or any `.env*` (except `.env.example`).
- Store the Supabase **service_role** key anywhere except `.env`. If you suspect it has been pushed to GitHub, rotate it immediately.

## 9. Pre-change checklist for any agent edit

Before opening a PR:

1. Did this change touch a route, stage name, output key, or required input column listed above? If yes, update this file in the same PR and update both the backend module and the React side.
2. Did this change introduce a subprocess or external call (HF, R, Supabase)? If yes, ensure timeout + structured error path + fallback.
3. Did this change introduce a secret? If yes, add it to `backend/.env.example` (placeholder only) and reference it via `process.env`.
4. Does `npm start` from `backend/` still print `hf_model`, `supabase`, and `r_runtime` lines without crashing when (a) all three are configured and (b) none of them are configured?
5. Does `GET /health` still return `{ ok: true, ... }`?

## 10. Where to start reading

If you are new (human or agent), read in this order:

1. [`AGENTS.md`](AGENTS.md) (this file) – the contract.
2. [`backend/README.md`](backend/README.md) – how to run + Postman/curl recipes + Supabase SQL migration.
3. [`backend/server.js`](backend/server.js) – routes only.
4. [`backend/src/jobs.js`](backend/src/jobs.js) – state machine.
5. [`backend/src/pipeline.js`](backend/src/pipeline.js) – the orchestration story.
6. [`backend/src/agents.js`](backend/src/agents.js) – Agent 1 + Agent 2 prompts and validation.
7. [`backend/src/hf.js`](backend/src/hf.js) – Hugging Face client.
8. [`backend/src/runner.js`](backend/src/runner.js) – Node ↔ R boundary.
9. [`backend/r/analyze_fallback.R`](backend/r/analyze_fallback.R) – baseline R fallback.
10. [`hack-princeton/`](hack-princeton/) – React surface, owned by the frontend teammate. The backend contract above is the only thing this side relies on.
