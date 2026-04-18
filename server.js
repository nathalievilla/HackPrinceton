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
 *   - Back-compat (deprecated, will be removed once frontend migrates):
 *       GET  /results?job_id=...     -> same as /results/:job_id
 *       POST /interpret              -> wraps llm.generateSummary
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const jobsModule = require("./src/jobs");
const runner = require("./src/runner");
const llm = require("./src/llm");
const pipeline = require("./src/pipeline");

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, "uploads");
const RESULTS_DIR = path.join(__dirname, "results");
const RUNTIME_DIR = path.join(__dirname, "runtime");
for (const dir of [UPLOAD_DIR, RESULTS_DIR, RUNTIME_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const id = crypto.randomBytes(6).toString("hex");
      cb(null, `${id}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ---------- routes ----------

app.get("/health", (_req, res) => {
  const r = runner.detectRRuntime();
  res.json({
    ok: true,
    llm_provider: llm.PROVIDER,
    r_runtime: r,
  });
});

/**
 * POST /upload
 *   multipart/form-data, field "file" (CSV).
 *   Enqueues an async pipeline run and returns immediately.
 */
app.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "file field is required" });
    }

    const job = jobsModule.createJob({
      uploadedFile: {
        name: req.file.originalname,
        path: req.file.path,
        size: req.file.size,
      },
    });

    const jobDir = path.join(RUNTIME_DIR, job.job_id);
    fs.mkdirSync(jobDir, { recursive: true });

    const resultsPath = path.join(RESULTS_DIR, `${job.job_id}.results.json`);
    const reportPath = path.join(RESULTS_DIR, `${job.job_id}.report.json`);

    // Fire-and-forget: pipeline owns all error handling via the job state.
    setImmediate(() => {
      pipeline
        .runPipeline({
          job_id: job.job_id,
          csvPath: req.file.path,
          jobDir,
          resultsPath,
          reportPath,
        })
        .catch((err) => {
          console.error(`pipeline crashed for job ${job.job_id}:`, err);
          jobsModule.failStage(job.job_id, job.stage || "uploaded", {
            message: err.message,
          });
        });
    });

    return res.json({ job_id: job.job_id, status: job.status });
  } catch (err) {
    console.error("POST /upload failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /jobs/:job_id
 *   The polling target for React. Returns the entire job state object.
 */
app.get("/jobs/:job_id", (req, res) => {
  const job = jobsModule.getJob(req.params.job_id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(job);
});

/**
 * GET /results/:job_id
 *   Returns the analysis JSON written by the pipeline.
 */
app.get("/results/:job_id", (req, res) => {
  const file = path.join(RESULTS_DIR, `${req.params.job_id}.results.json`);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "results not ready or job not found" });
  }
  try {
    res.json(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (err) {
    res.status(500).json({ error: "failed to parse results", details: err.message });
  }
});

/**
 * GET /report/:job_id
 *   Returns the final report JSON (includes manager check).
 */
app.get("/report/:job_id", (req, res) => {
  const file = path.join(RESULTS_DIR, `${req.params.job_id}.report.json`);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "report not ready or job not found" });
  }
  try {
    res.json(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (err) {
    res.status(500).json({ error: "failed to parse report", details: err.message });
  }
});

// ---------- back-compat (deprecated) ----------

app.get("/results", (req, res) => {
  const job_id = req.query.job_id;
  if (!job_id || typeof job_id !== "string") {
    return res.status(400).json({ error: "job_id query param is required" });
  }
  req.params.job_id = job_id;
  const file = path.join(RESULTS_DIR, `${job_id}.results.json`);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "results not ready or job not found" });
  }
  try {
    res.set("X-Deprecated", "use GET /results/:job_id");
    res.json(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (err) {
    res.status(500).json({ error: "failed to parse results", details: err.message });
  }
});

app.post("/interpret", async (req, res) => {
  try {
    const results = req.body;
    if (!results || typeof results !== "object") {
      return res.status(400).json({ error: "expected results JSON in body" });
    }
    const summary = await llm.generateSummary(results);
    res.set("X-Deprecated", "use GET /report/:job_id (manager check included)");
    res.json({ interpretation: summary.summary, provider: summary.provider });
  } catch (err) {
    console.error("POST /interpret failed:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(PORT, () => {
  const r = runner.detectRRuntime();
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(`  llm_provider = ${llm.PROVIDER}`);
  console.log(`  r_runtime    = ${r.available ? r.version : "UNAVAILABLE - synthetic outputs"}`);
});
