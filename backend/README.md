# HackPrinceton Backend

Express API that glues the React frontend to the R analysis pipeline
and the Gemini interpretation layer.

## Pipeline

```
React -> POST /upload   (CSV)           -> saves results/<job_id>.json
React -> GET  /results?job_id=...        -> returns that JSON
React -> POST /interpret (results JSON)  -> Gemini paragraph
```

Everything is a working stub today: each endpoint returns dummy data
so the frontend can build against a real API immediately.

## Run

```bash
cd backend
npm install
cp .env.example .env   # then paste your GEMINI_API_KEY
npm start              # -> http://localhost:3000
```

Smoke test: `curl http://localhost:3000/health` should return `{"ok":true}`.

## Endpoints

### `GET /health`
Returns `{ "ok": true }`. Use this to check the server is up.

### `POST /upload`
- `multipart/form-data`, field name `file` (CSV).
- Response: `{ "job_id": "abc123", "status": "ok" }`.
- Today: writes dummy results JSON. Replace the `TODO (R integration)`
  block in [`server.js`](server.js) with a real R call.

### `GET /results?job_id=abc123`
- Returns the JSON written by `/upload`.
- 404 if `job_id` is unknown.

### `POST /interpret`
- Body: the results JSON (same shape `/results` returns).
- Response: `{ "interpretation": "..." }`.
- Today: returns a placeholder paragraph. Replace the
  `TODO (Gemini integration)` block in [`server.js`](server.js).

## Testing in Postman

1. **POST** `http://localhost:3000/upload` -> Body -> form-data ->
   key `file` (type: File) -> pick any CSV -> Send.
   Copy the `job_id` from the response.
2. **GET** `http://localhost:3000/results?job_id=<paste>` -> Send.
3. **POST** `http://localhost:3000/interpret` -> Body -> raw -> JSON ->
   paste the JSON from step 2 -> Send.

## Folder layout

```
backend/
  server.js          <- all routes + stubs live here (start here)
  package.json
  .env.example       <- copy to .env for secrets
  .gitignore
  uploads/           <- incoming CSVs (gitignored)
  results/           <- R output JSON, one file per job_id (gitignored)
```

## Where to plug things in

- **R pipeline:** `POST /upload` handler in [`server.js`](server.js),
  look for `TODO (R integration)`.
- **Gemini:** `POST /interpret` handler in [`server.js`](server.js),
  look for `TODO (Gemini integration)`.
- **New routes:** add another `app.get(...)` / `app.post(...)` above
  the 404 fallthrough at the bottom of `server.js`.

## Gotchas

- Restart the server after editing `server.js` (no hot reload).
- If port 3000 is busy: `set PORT=3001 && npm start` (cmd) or
  `$env:PORT=3001; npm start` (PowerShell).
- Never commit `.env` - it holds the Gemini API key.
- `uploads/` and `results/` are gitignored on purpose; don't `git add -f` them.
