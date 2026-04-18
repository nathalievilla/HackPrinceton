/**
 * HackPrinceton backend - async AI+R pipeline.
 *
 * IMPORTANT (agent guardrail):
 *   - This file is intentionally small. Routes only. Heavy logic lives in
 *     src/jobs.js, src/runner.js, src/validators.js, src/llm.js, and
 *     src/pipeline.js. See ../AGENTS.md for the full architecture contract.
 *
 *   - React-facing API contract (do not rename without versioned migration):
 *       GET  /health                 -> { ok, r_runtime }
 *       POST /upload                 -> { job_id, status: "queued" }
 *       GET  /jobs/:job_id           -> full job state (polling target)
 *       GET  /results/:job_id        -> R analysis + summary
 *       GET  /report/:job_id         -> final report incl. manager check
 *
 *   - Temporary compatibility (slated for removal in a future team PR):
 *       GET  /results?job_id=...     -> same as /results/:job_id
 *
 *   - Future endpoints (NOT implemented yet, see ../AGENTS.md backlog):
 *       POST /agent1                 -> CSV -> Gemma biostatistician -> R code -> exec
 *       POST /agent2                 -> Agent1 output -> Gemma manager QC + summary
 *       GET  /trial-context          -> TREKIDS metadata
 */

require('dotenv').config()

const express = require('express')
const cors = require('cors')
const multer = require('multer')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')

const jobsModule = require('./src/jobs')
const runner = require('./src/runner')
const llm = require('./src/llm')
const pipeline = require('./src/pipeline')

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

app.get('/health', (_req, res) => {
  const r = runner.detectRRuntime()
  res.json({
    ok: true,
    llm_provider: llm.PROVIDER,
    r_runtime: r,
  })
})

app.post('/upload', upload.single('file'), async (req, res) => {
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

    const job = jobsModule.createJob({
      uploadedFile: {
        name: req.file.originalname,
        path: req.file.path,
        size: req.file.size,
      },
    })

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
          console.error(`pipeline crashed for job ${job.job_id}:`, err)
          jobsModule.failStage(job.job_id, job.stage || 'uploaded', {
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
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'report not ready or job not found' })
  }
  try {
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (err) {
    res.status(500).json({ error: 'failed to parse report', details: err.message })
  }
})

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

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' })
})

app.listen(PORT, () => {
  const r = runner.detectRRuntime()
  console.log(`API listening on http://localhost:${PORT}`)
  console.log(`  llm_provider = ${llm.PROVIDER}`)
  console.log(`  r_runtime    = ${r.available ? r.version : 'UNAVAILABLE - synthetic outputs'}`)
})