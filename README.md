# HackPrinceton Backend

Express API that orchestrates an AI-driven R analysis pipeline for the React
frontend in [`../hack-princeton`](../hack-princeton).

> Read [`../AGENTS.md`](../AGENTS.md) before making structural changes. It is
> the source of truth for the API contract, module boundaries, and safety
> guardrails.

## Pipeline (high level)

```
React  --POST /upload (CSV)-->  Express
                                  |
                                  v
                            jobs.createJob (queued)
                                  |
            +---------------------+---------------------+
            |   pipeline.runPipeline (async, fire-and-forget)        |
            |   1. validate CSV                                      |
            |   2. llm.generateAnalysisPlan                          |
            |   3. llm.generateRCode                                 |
            |   4. runner.runGeneratedRScript  (R subprocess)        |
            |   5. validators.validateRRunOutput                     |
            |   6. llm.generateSummary                               |
            |   7. llm.managerCheck    (second AI pass)              |
            |   8. write results + report JSON                       |
            +-------------------------------+-----------------------+
                                  |
React  <--GET /jobs/:id (polling)--+
React  <--GET /results/:id--------+
React  <--GET /report/:id---------+
```

## Run

```bash
cd backend
npm install
cp .env.example .env       # fill keys later if you wire a real LLM
npm start                  # -> http://localhost:3000
```

On startup the server prints:

```
API listening on http://localhost:3000
  llm_provider = fallback
  r_runtime    = R scripting front-end version 4.x.x  (or "UNAVAILABLE - synthetic outputs")
```

If R is not installed the pipeline still runs end-to-end; results are flagged
`synthetic: true` so the UI can show a banner.

## Endpoints

### `GET /health`

```json
{
  "ok": true,
  "llm_provider": "fallback",
  "r_runtime": { "available": true, "version": "..." }
}
```

### `POST /upload`

multipart/form-data, field `file` = CSV.

```json
{ "job_id": "abcdef123456", "status": "queued" }
```

### `GET /jobs/:job_id`  (React polls this every ~2 s)

Returns the full job state. Key fields:

- `status`: `queued | running | completed | failed`
- `stage`: current stage name (see `src/jobs.js` `STAGES`)
- `progress`: 0-100
- `stages[]`: timeline the UI renders directly
- `error`: `{ stage, message, details }` when `status === "failed"`

### `GET /results/:job_id`

Returns the analysis JSON written by R (after schema validation), plus a
plain-English `summary` and `execution` metadata.

### `GET /report/:job_id`

Returns the final report:

```json
{
  "job_id": "...",
  "headline": "...",
  "manager_check": {
    "clinically_reasonable": true,
    "flags": [...],
    "notes": "..."
  },
  "results": { ... }
}
```

### Deprecated (still works)

- `GET /results?job_id=...`
- `POST /interpret`

These set an `X-Deprecated` response header.

## Curl smoke test

```bash
# 1. health
curl http://localhost:3000/health

# 2. upload a CSV (any small CSV will do)
curl -F "file=@example.csv" http://localhost:3000/upload
# -> { "job_id": "abc123", "status": "queued" }

# 3. poll
curl http://localhost:3000/jobs/abc123

# 4. once status == "completed"
curl http://localhost:3000/results/abc123
curl http://localhost:3000/report/abc123
```

## Postman recipe

1. **POST** `http://localhost:3000/upload` -> Body -> form-data ->
   key `file` (type **File**) -> any `.csv`. Send. Copy `job_id`.
2. **GET** `http://localhost:3000/jobs/{{job_id}}`. Re-send until
   `status` is `"completed"` (usually < 2 s without R, longer with R).
3. **GET** `http://localhost:3000/results/{{job_id}}` and
   `http://localhost:3000/report/{{job_id}}`.

## Folder layout

```
backend/
  server.js              routes only (~150 lines, see AGENTS.md)
  src/
    jobs.js              in-memory job state machine
    pipeline.js          stage-by-stage orchestration
    runner.js            Node -> R subprocess adapter
    validators.js        schema checks
    llm.js               provider-agnostic AI wrapper (with fallbacks)
  r/
    analyze.R            baseline R analysis (safe scaffold default)
  uploads/               (gitignored) raw CSVs
  runtime/<job_id>/      (gitignored) generated R script + raw output
  results/<job_id>.*     (gitignored) results + report JSON
```

## Where to plug things in

- **Real R analysis**: edit [`r/analyze.R`](r/analyze.R) or replace the
  baseline returned by `llm.generateRCode` in [`src/llm.js`](src/llm.js).
  The output JSON must keep the keys validated in
  [`src/validators.js`](src/validators.js) (`shap`, `survival`, `subgroups`).
- **Real LLM (Gemini, Gradient, OpenAI, etc.)**: implement the provider
  branch in [`src/llm.js`](src/llm.js). Keep the function signatures and
  the deterministic fallback path.
- **New analysis stage**: add a name to `STAGES` in
  [`src/jobs.js`](src/jobs.js), call `startStage`/`finishStage` from
  [`src/pipeline.js`](src/pipeline.js). React renders the new step
  automatically from `job.stages`.

## Gotchas

- Restart `node server.js` after editing backend code (no hot reload).
- If port 3000 is busy: `set PORT=3001 && npm start` (cmd) or
  `$env:PORT=3001; npm start` (PowerShell).
- Never commit `.env`. Never commit `uploads/`, `results/`, or `runtime/`.
- The job registry is **in-memory**. Restarting the server drops jobs.
  This is fine for the hackathon; swap to SQLite/Redis later if needed.

## Reading order for a new contributor

1. [`../AGENTS.md`](../AGENTS.md)
2. This file
3. [`server.js`](server.js)
4. [`src/jobs.js`](src/jobs.js) -> [`src/pipeline.js`](src/pipeline.js)
5. [`src/runner.js`](src/runner.js) -> [`r/analyze.R`](r/analyze.R)
6. [`src/llm.js`](src/llm.js)
