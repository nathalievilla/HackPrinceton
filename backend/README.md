# HackPrinceton Backend

Express API that orchestrates a Hugging Face Gemma two-agent R analysis
pipeline for the React frontend in [`../hack-princeton`](../hack-princeton).

> Read [`../AGENTS.md`](../AGENTS.md) before making structural changes. It is
> the source of truth for the API contract, module boundaries, and safety
> guardrails.

## Pipeline (high level)

```
React  --POST /upload (CSV)-->  Express
                                  |  validate columns (age, trt, label)
                                  |  save to Supabase csv_uploads
                                  v
                          jobs.createJob (queued)
                                  |
            +---------------------+----------------------+
            |  pipeline.runPipeline (async)              |
            |  1. agents.runAgent1                       |
            |     - Gemma biostatistician -> R code      |
            |     - runner.runGeneratedRScript -> output |
            |     - db.saveAgent1Output (separate row)   |
            |  2. validators.validateRRunOutput          |
            |  3. agents.runAgent2                       |
            |     - Gemma manager -> QC + summary        |
            |     - db.saveAgent2Output (separate row)   |
            |  4. write report JSON + db.saveReport      |
            +-------------------------------+------------+
                                  |
React  <--GET /jobs/:id (polling)--+
React  <--GET /results/:id--------+
React  <--GET /report/:id---------+
React  <--GET /results------------+  (history list from Supabase)
React  <--GET /trial-context------+  (ACTG 175 metadata stub)
```

## Run

```bash
cd backend
npm install
cp .env.example .env       # fill in HF_TOKEN and Supabase keys
npm start                  # -> http://localhost:3000
```

On startup the server prints:

```
API listening on http://localhost:3000
  hf_model    = google/gemma-2-27b-it
  supabase    = configured
  r_runtime   = R scripting front-end version 4.x.x  (or "UNAVAILABLE - synthetic outputs")
```

The pipeline runs end-to-end **even if HF, Supabase, or R is missing** —
agents fall back to deterministic templates, persistence is skipped silently,
and R falls back to synthetic outputs. The demo never crashes because of an
external dependency.

## Endpoints

### `GET /health`

```json
{
  "ok": true,
  "r_runtime": { "available": true, "version": "..." },
  "hf": { "configured": true, "model": "google/gemma-2-27b-it" },
  "supabase": { "configured": true }
}
```

### `POST /upload`

multipart/form-data, field `file` = CSV with columns `age`, `trt`, `label`.

- 200: `{ "job_id": "abcdef123456", "status": "queued" }`
- 400 (invalid columns):
  ```json
  {
    "error": "missing_required_columns",
    "required": ["age", "trt", "label"],
    "details": [{ "code": "missing_column", "column": "trt", "message": "Required column \"trt\" is missing." }],
    "columns_found": ["age", "label", "weight"]
  }
  ```

### `GET /jobs/:job_id`  (React polls this every ~2 s)

Returns the full job state. Key fields:

- `status`: `queued | running | completed | failed`
- `stage`: `uploaded | agent1_planning | qa_validation | agent2_review | completed`
- `progress`: 0-100
- `stages[]`: timeline the UI renders directly
- `error`: `{ stage, message, details }` when `status === "failed"`

### `GET /results`

List of past analyses (Supabase). Returns `{ rows: [] }` if Supabase is not configured.

### `GET /results/:job_id`

Returns the analysis JSON: schema-validated R output + `summary` + `agent1_provider` + `execution` metadata.

### `GET /report/:job_id`

Returns the final report:

```json
{
  "job_id": "...",
  "headline": "...",
  "agent1": { "provider": "huggingface", "model": "...", "execution": {...} },
  "agent2": { "provider": "huggingface", "clinically_reasonable": true, "flags": [...] },
  "manager_check": { "clinically_reasonable": true, "flags": [...], "notes": "..." },
  "results": { ... }
}
```

### `POST /agent1` (standalone, for testing)

Two ways to call:

1. **multipart/form-data**, field `file` = CSV. Validates columns; runs Gemma + R.
2. **application/json**: `{ "csv_path": "/abs/path.csv", "csv_meta": { "columns": [...], "row_count": 100 } }`.

Returns: `{ provider, model, r_code, output, execution, used_fallback_reason }`.

### `POST /agent2` (standalone, for testing)

application/json: `{ "agent1_output": <object> }`.

Returns: `{ provider, model, clinically_reasonable, flags, summary }`.

### `GET /trial-context`

Returns ACTG 175 metadata. Stub for now; will be backed by TREKIDS.

## Curl smoke test

```bash
curl http://localhost:3000/health

# upload (must include age, trt, label columns)
curl -F "file=@mockdata/AIDS_ClinicalTrial_GroupStudy175.csv" http://localhost:3000/upload
# -> { "job_id": "abc123", "status": "queued" }

curl http://localhost:3000/jobs/abc123
curl http://localhost:3000/results/abc123
curl http://localhost:3000/report/abc123

curl http://localhost:3000/results
curl http://localhost:3000/trial-context
```

## Postman recipes

**Upload + poll:**
1. **POST** `http://localhost:3000/upload` -> Body -> form-data ->
   key `file` (type **File**) -> any `.csv` with `age, trt, label`. Send. Copy `job_id`.
2. **GET** `http://localhost:3000/jobs/{{job_id}}`. Re-send until
   `status` is `"completed"`.
3. **GET** `http://localhost:3000/results/{{job_id}}` and
   `http://localhost:3000/report/{{job_id}}`.

**Test Agent 1 directly:**
- **POST** `http://localhost:3000/agent1` -> Body -> form-data ->
  key `file` (type **File**) -> a CSV. Returns R code + output JSON.

**Test Agent 2 directly:**
- **POST** `http://localhost:3000/agent2` -> Body -> raw -> JSON ->
  `{ "agent1_output": { "shap": {...}, "survival": {...}, "subgroups": [...] } }`.

## Folder layout

```
backend/
  server.js              routes only (~270 lines)
  src/
    jobs.js              in-memory job state machine
    pipeline.js          stage-by-stage orchestration
    agents.js            Agent 1 + Agent 2 prompts, validation, fallbacks
    hf.js                Hugging Face Inference client
    runner.js            Node -> R subprocess adapter
    validators.js        CSV column + R output schema checks
    db.js                Supabase persistence (graceful no-op if unconfigured)
    trialContext.js      ACTG 175 metadata (TREKIDS stub)
  r/
    analyze_fallback.R   baseline R analysis used as fallback
  uploads/               (gitignored) raw CSVs
  runtime/<job_id>/      (gitignored) generated R script + raw output
  results/<job_id>.*     (gitignored) results + report JSON
```

## Supabase schema (run this once in Supabase SQL Editor)

```sql
-- jobs: one row per analysis run; agent outputs stored separately for audit.
create table if not exists jobs (
  job_id text primary key,
  status text,
  stage text,
  progress int,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz,
  uploaded_file jsonb,
  stages jsonb,
  artifacts jsonb,
  error jsonb,

  -- Agent 1 (biostatistician)
  agent1_provider text,
  agent1_model    text,
  agent1_r_code   text,
  agent1_output   jsonb,
  agent1_execution jsonb,

  -- Agent 2 (manager / QC)
  agent2_provider text,
  agent2_model    text,
  agent2_qc       jsonb,
  agent2_summary  text,

  -- Convenience
  summary text,
  report  jsonb
);

-- csv_uploads: every upload, even ones that don't finish.
create table if not exists csv_uploads (
  id uuid primary key default gen_random_uuid(),
  job_id text references jobs(job_id) on delete set null,
  original_filename text,
  row_count int,
  columns jsonb,
  summary text,
  created_at timestamptz default now()
);
```

The backend uses the **service_role** key for writes. Keep that key in
`backend/.env` only and never commit it.

## Where to plug things in

- **Real R analysis (richer than the fallback)**: edit
  [`r/analyze_fallback.R`](r/analyze_fallback.R) or improve the Agent 1
  system prompt in [`src/agents.js`](src/agents.js). Output JSON must keep
  the keys validated in [`src/validators.js`](src/validators.js)
  (`shap`, `survival`, `subgroups`).
- **Switch HF model**: change `HF_MODEL` in `.env`. Default
  `google/gemma-2-27b-it`. `google/gemma-3-27b-it` works too if you have
  serverless access.
- **Different LLM provider entirely**: implement `callGemma`-equivalent in
  a new file and swap the import in [`src/agents.js`](src/agents.js). Keep
  the function signature and the deterministic fallback path.
- **Real TREKIDS lookup**: replace the stub in
  [`src/trialContext.js`](src/trialContext.js). Keep the same return shape.

## Gotchas

- Restart `node server.js` after editing backend code (no hot reload).
- If port 3000 is busy: `set PORT=3001 && npm start` (cmd) or
  `$env:PORT=3001; npm start` (PowerShell).
- Never commit `.env`. Never commit `uploads/`, `results/`, or `runtime/`.
- The job registry is **in-memory**. Restarting the server drops in-flight
  jobs (Supabase rows survive). This is fine for the hackathon; swap to
  SQLite/Redis later if needed.
- HF Serverless can be flaky for very large models. The fallback layer
  ensures the demo still produces a valid response, just with lower-quality
  R + a deterministic summary.

## Reading order for a new contributor

1. [`../AGENTS.md`](../AGENTS.md)
2. This file
3. [`server.js`](server.js)
4. [`src/jobs.js`](src/jobs.js) -> [`src/pipeline.js`](src/pipeline.js)
5. [`src/agents.js`](src/agents.js) -> [`src/hf.js`](src/hf.js)
6. [`src/runner.js`](src/runner.js) -> [`r/analyze_fallback.R`](r/analyze_fallback.R)
7. [`src/db.js`](src/db.js)
