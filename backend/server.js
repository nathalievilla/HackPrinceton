/**
 * HackPrinceton backend - HF Gemma two-agent R analysis pipeline.
 *
 * IMPORTANT (agent guardrail):
 *   - This file is intentionally small. Routes only. Heavy logic lives in
 *     src/jobs.js, src/runner.js, src/validators.js, src/hf.js, src/agents.js,
 *     src/db.js, src/pipeline.js, src/trialContext.js.
 *     See ../AGENTS.md for the full architecture contract.
 *
 *   - React-facing API contract (do not rename without versioned migration):
 *       GET  /health                 -> { ok, r_runtime, hf, supabase }
 *       POST /upload                 -> { job_id, status: "queued" }
 *                                       400 with structured errors if columns invalid
 *       GET  /jobs/:job_id           -> full job state (polling target)
 *       GET  /results                -> list of past analyses (Supabase)
 *       GET  /results/:job_id        -> Agent 1 + Agent 2 + R code for one job
 *       GET  /report/:job_id         -> final report incl. manager check
<<<<<<< Updated upstream
 *
 *   - Temporary compatibility (slated for removal in a future team PR):
 *       GET  /results?job_id=...     -> same as /results/:job_id
 *
 *   - Future endpoints (NOT implemented yet, see ../AGENTS.md backlog):
 *       POST /agent1                 -> CSV -> Gemma biostatistician -> R code -> exec
 *       POST /agent2                 -> Agent1 output -> Gemma manager QC + summary
 *       GET  /trial-context          -> TREKIDS metadata
=======
 *       POST /agent1                 -> standalone Gemma biostatistician + R run
 *       POST /agent2                 -> standalone Gemma manager + summary
 *       GET  /trial-context          -> ACTG 175 metadata (TREKIDS stub)
>>>>>>> Stashed changes
 */

require('dotenv').config()

const express = require('express')
const cors = require('cors')
const multer = require('multer')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')

<<<<<<< Updated upstream
const jobsModule = require('./src/jobs')
const runner = require('./src/runner')
const llm = require('./src/llm')
const pipeline = require('./src/pipeline')
=======
const jobsModule = require("./src/jobs");
const runner = require("./src/runner");
const hf = require("./src/hf");
const validators = require("./src/validators");
const agents = require("./src/agents");
const db = require("./src/db");
const pipeline = require("./src/pipeline");
const trialContext = require("./src/trialContext");
>>>>>>> Stashed changes

const app = express()
const PORT = process.env.PORT || 3000

// Use the service role key here — this bypasses RLS so the backend can write
// rows on behalf of any user. Never expose this key on the frontend.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const UPLOAD_DIR = path.join(__dirname, 'uploads')
const RESULTS_DIR = path.join(__dirname, 'results')
const RUNTIME_DIR = path.join(__dirname, 'runtime')
for (const dir of [UPLOAD_DIR, RESULTS_DIR, RUNTIME_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

app.use(cors())
app.use(express.json({ limit: '10mb' }))

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const id = crypto.randomBytes(6).toString('hex')
      cb(null, `${id}-${file.originalname}`)
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
})

// ---------- helpers ----------

// Reads the header row and counts data rows from a CSV file on disk.
function readCsvMeta(csvPath) {
  try {
    const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean)
    const columns = (lines[0] || '').split(',').map(c => c.trim())
    const row_count = Math.max(0, lines.length - 1)
    return { columns, row_count }
  } catch {
    return { columns: [], row_count: 0 }
  }
}

// ---------- routes ----------

<<<<<<< Updated upstream
app.get('/health', (_req, res) => {
  const r = runner.detectRRuntime()
  res.json({
    ok: true,
    llm_provider: llm.PROVIDER,
    r_runtime: r,
  })
})

app.post('/upload', upload.single('file'), async (req, res) => {
=======
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    r_runtime: runner.detectRRuntime(),
    hf: { configured: hf.isConfigured(), model: hf.HF_MODEL },
    supabase: { configured: db.isConfigured() },
  });
});

/**
 * POST /upload
 * multipart/form-data, field "file" (CSV).
 * Validates columns synchronously; returns 400 with structured errors
 * if invalid. Otherwise queues the async pipeline and returns immediately.
 */
app.post("/upload", upload.single("file"), (req, res) => {
>>>>>>> Stashed changes
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'file field is required' })
    }

    // Verify the user's JWT sent by the frontend in the Authorization header.
    // getUser() validates the token against Supabase and returns the user record.
    const authHeader = req.headers.authorization || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) {
      return res.status(401).json({ error: 'missing authorization header' })
    }
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return res.status(401).json({ error: 'invalid or expired token' })
    }

    const fileCheck = validators.validateUploadedCsv(req.file.path);
    if (!fileCheck.ok) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ error: "invalid_file", details: fileCheck.errors });
    }

    const colCheck = validators.validateCsvColumns(req.file.path);
    if (!colCheck.ok) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({
        error: "missing_required_columns",
        required: validators.REQUIRED_INPUT_COLUMNS,
        details: colCheck.errors,
        columns_found: colCheck.columns,
      });
    }

    const job = jobsModule.createJob({
      uploadedFile: {
        name: req.file.originalname,
        path: req.file.path,
        size: req.file.size,
      },
    })

<<<<<<< Updated upstream
    const jobDir = path.join(RUNTIME_DIR, job.job_id)
    fs.mkdirSync(jobDir, { recursive: true })

    const resultsPath = path.join(RESULTS_DIR, `${job.job_id}.results.json`)
    const reportPath = path.join(RESULTS_DIR, `${job.job_id}.report.json`)

    // Persist the upload record to Supabase immediately so the row exists
    // even if the pipeline hasn't finished yet. Summary gets patched in
    // by pipeline.js once the job completes.
    const { columns, row_count } = readCsvMeta(req.file.path)
    const { error: insertError } = await supabase.from('csv_uploads').insert({
      user_id: user.id,
      job_id: job.job_id,
      original_filename: req.file.originalname,
      row_count,
      columns,
      summary: null,
      uploaded_at: new Date().toISOString(),
    })
    if (insertError) {
      // Non-fatal: log but don't block the analysis
      console.error('Supabase insert failed:', insertError.message)
    }
=======
    const jobDir = path.join(RUNTIME_DIR, job.job_id);
    fs.mkdirSync(jobDir, { recursive: true });
    const resultsPath = path.join(RESULTS_DIR, `${job.job_id}.results.json`);
    const reportPath = path.join(RESULTS_DIR, `${job.job_id}.report.json`);
>>>>>>> Stashed changes

    setImmediate(() => {
      pipeline
        .runPipeline({
          job_id: job.job_id,
          csvPath: req.file.path,
          jobDir,
          resultsPath,
          reportPath,
          // Pass through so pipeline can patch the summary once it's ready
          supabase,
        })
        .catch((err) => {
<<<<<<< Updated upstream
          console.error(`pipeline crashed for job ${job.job_id}:`, err)
          jobsModule.failStage(job.job_id, job.stage || 'uploaded', {
=======
          console.error(`pipeline crashed for job ${job.job_id}:`, err);
          jobsModule.failStage(job.job_id, jobsModule.getJob(job.job_id)?.stage || "uploaded", {
>>>>>>> Stashed changes
            message: err.message,
          })
        })
    })

    return res.json({ job_id: job.job_id, status: job.status })
  } catch (err) {
    console.error('POST /upload failed:', err)
    return res.status(500).json({ error: 'internal_error' })
  }
})

<<<<<<< Updated upstream
app.get('/jobs/:job_id', (req, res) => {
  const job = jobsModule.getJob(req.params.job_id)
  if (!job) return res.status(404).json({ error: 'job not found' })
  res.json(job)
})

app.get('/results/:job_id', (req, res) => {
  const file = path.join(RESULTS_DIR, `${req.params.job_id}.results.json`)
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'results not ready or job not found' })
  }
  try {
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (err) {
    res.status(500).json({ error: 'failed to parse results', details: err.message })
  }
})

app.get('/report/:job_id', (req, res) => {
  const file = path.join(RESULTS_DIR, `${req.params.job_id}.report.json`)
=======
/**
 * GET /jobs/:job_id - polling target for React.
 */
app.get("/jobs/:job_id", (req, res) => {
  const job = jobsModule.getJob(req.params.job_id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(job);
});

/**
 * GET /results - list past analyses from Supabase.
 * Returns [] if Supabase isn't configured (no error).
 */
app.get("/results", async (_req, res) => {
  const result = await db.getRecentAnalyses({ limit: 25 });
  if (result.skipped) {
    return res.json({ rows: [], note: "Supabase not configured; persistence disabled" });
  }
  if (!result.ok) {
    return res.status(500).json({ error: result.error, rows: [] });
  }
  res.json({ rows: result.rows });
});

/**
 * GET /results/:job_id - one full analysis (Agent 1 + Agent 2 + R code).
 * Reads from the on-disk results file first; falls back to Supabase row.
 */
app.get("/results/:job_id", async (req, res) => {
  const file = path.join(RESULTS_DIR, `${req.params.job_id}.results.json`);
  if (fs.existsSync(file)) {
    try {
      return res.json(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (err) {
      return res.status(500).json({ error: "failed to parse results", details: err.message });
    }
  }
  const dbRow = await db.getAnalysisById(req.params.job_id);
  if (dbRow.row) return res.json(dbRow.row);
  return res.status(404).json({ error: "results not ready or job not found" });
});

/**
 * GET /report/:job_id - final report JSON.
 */
app.get("/report/:job_id", (req, res) => {
  const file = path.join(RESULTS_DIR, `${req.params.job_id}.report.json`);
>>>>>>> Stashed changes
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'report not ready or job not found' })
  }
  try {
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (err) {
    res.status(500).json({ error: 'failed to parse report', details: err.message })
  }
})

<<<<<<< Updated upstream
// temporary compatibility shim
app.get('/results', (req, res) => {
  const job_id = req.query.job_id
  if (!job_id || typeof job_id !== 'string') {
    return res.status(400).json({ error: 'job_id query param is required' })
  }
  const file = path.join(RESULTS_DIR, `${job_id}.results.json`)
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'results not ready or job not found' })
  }
  try {
    res.set('X-Deprecated', 'use GET /results/:job_id')
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (err) {
    res.status(500).json({ error: 'failed to parse results', details: err.message })
  }
})
=======
/**
 * POST /agent1 - standalone Gemma biostatistician.
 * Two ways to call:
 *   (a) multipart/form-data with field "file" (CSV)  -> validates + runs
 *   (b) application/json with { csv_meta, csv_path } -> runs directly (advanced)
 *
 * Returns: { provider, model, r_code, output, execution }
 */
app.post("/agent1", upload.single("file"), async (req, res) => {
  try {
    let csvPath = null;
    let csvMeta = null;
    let cleanupAfter = false;

    if (req.file) {
      csvPath = req.file.path;
      const colCheck = validators.validateCsvColumns(csvPath);
      if (!colCheck.ok) {
        try { fs.unlinkSync(csvPath); } catch (_) {}
        return res.status(400).json({
          error: "missing_required_columns",
          required: validators.REQUIRED_INPUT_COLUMNS,
          details: colCheck.errors,
          columns_found: colCheck.columns,
        });
      }
      csvMeta = { columns: colCheck.columns, row_count: null };
      cleanupAfter = true;
    } else if (req.body && req.body.csv_path && req.body.csv_meta) {
      csvPath = req.body.csv_path;
      csvMeta = req.body.csv_meta;
    } else {
      return res.status(400).json({
        error: "provide either multipart 'file' or JSON { csv_path, csv_meta }",
      });
    }

    const jobDir = path.join(RUNTIME_DIR, "adhoc-" + crypto.randomBytes(4).toString("hex"));
    fs.mkdirSync(jobDir, { recursive: true });

    const result = await agents.runAgent1({ csvMeta, csvPath, jobDir });

    if (cleanupAfter) {
      try { fs.unlinkSync(csvPath); } catch (_) {}
    }

    res.json(result);
  } catch (err) {
    console.error("POST /agent1 failed:", err);
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

/**
 * POST /agent2 - standalone Gemma manager / QC.
 * Body: { agent1_output: <object> }
 * Returns: { provider, model, clinically_reasonable, flags, summary }
 */
app.post("/agent2", async (req, res) => {
  try {
    const agent1Output = req.body && req.body.agent1_output;
    if (!agent1Output || typeof agent1Output !== "object") {
      return res.status(400).json({ error: "body must include agent1_output object" });
    }
    const result = await agents.runAgent2(agent1Output);
    res.json(result);
  } catch (err) {
    console.error("POST /agent2 failed:", err);
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

/**
 * GET /trial-context - returns ACTG 175 metadata (TREKIDS stub for now).
 */
app.get("/trial-context", (_req, res) => {
  res.json(trialContext.getTrialContext());
});
>>>>>>> Stashed changes

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' })
})

app.listen(PORT, () => {
<<<<<<< Updated upstream
  const r = runner.detectRRuntime()
  console.log(`API listening on http://localhost:${PORT}`)
  console.log(`  llm_provider = ${llm.PROVIDER}`)
  console.log(`  r_runtime    = ${r.available ? r.version : 'UNAVAILABLE - synthetic outputs'}`)
})
=======
  const r = runner.detectRRuntime();
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(`  hf_model    = ${hf.HF_MODEL}${hf.isConfigured() ? "" : "  (HF_TOKEN not set; will use deterministic fallback)"}`);
  console.log(`  supabase    = ${db.isConfigured() ? "configured" : "not configured (persistence disabled)"}`);
  console.log(`  r_runtime   = ${r.available ? r.version : "UNAVAILABLE - synthetic outputs"}`);
});
>>>>>>> Stashed changes
