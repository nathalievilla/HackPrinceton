/**
 * HackPrinceton backend - MVP template.
 *
 * Pipeline:
 *   1. Frontend POSTs a patient CSV to   POST /upload
 *   2. Backend runs the R analysis (SHAP + survival + subgroups)
 *      and stores the result JSON keyed by job_id.
 *   3. Frontend fetches                   GET  /results?job_id=...
 *   4. Frontend POSTs those results to    POST /interpret
 *      which asks Gemini for a plain-English paragraph.
 *
 * Everything below is a working stub: it returns DUMMY data so the
 * React teammate can build the UI against a real API today. Replace
 * the TODO blocks with real logic later.
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- folders ----------
// Uploaded CSVs land here. R output JSON also lives here, keyed by job_id.
// Both are gitignored (see .gitignore).
const UPLOAD_DIR = path.join(__dirname, "uploads");
const RESULTS_DIR = path.join(__dirname, "results");
for (const dir of [UPLOAD_DIR, RESULTS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---------- middleware ----------
app.use(cors()); // allow the Vite dev server (5173) to call us
app.use(express.json({ limit: "10mb" })); // parse JSON bodies for /interpret

// multer handles multipart/form-data (file uploads).
// Files are written to disk under uploads/ with a random filename.
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const id = crypto.randomBytes(6).toString("hex");
      cb(null, `${id}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB, plenty for a patient CSV
});

// ---------- routes ----------

// Smoke test: curl http://localhost:3000/health
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * POST /upload
 * Receives a CSV file (multipart/form-data, field name "file").
 * Returns: { job_id, status }
 *
 * TODO (R integration):
 *   - Spawn Rscript with the uploaded CSV path and an output JSON path:
 *       child_process.spawn("Rscript", ["analyze.R", csvPath, outPath])
 *   - Write the R output to results/<job_id>.json
 *   - Or, for a safer demo: ignore the upload and copy a precomputed
 *     JSON into results/<job_id>.json.
 */
app.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "file field is required" });
    }

    const job_id = crypto.randomBytes(6).toString("hex");
    const outPath = path.join(RESULTS_DIR, `${job_id}.json`);

    // TODO: replace this dummy result with real R pipeline output.
    const dummyResult = {
      job_id,
      uploaded_file: req.file.originalname,
      shap: {
        features: ["eosinophils", "age", "prior_hospitalizations", "fev1"],
        importance: [0.42, 0.21, 0.18, 0.09],
      },
      survival: {
        time_points: [0, 4, 8, 12, 16, 20, 24],
        curves: {
          overall: [1.0, 0.95, 0.9, 0.82, 0.78, 0.74, 0.7],
          high_eosinophil: [1.0, 0.98, 0.96, 0.93, 0.9, 0.88, 0.85],
          low_eosinophil: [1.0, 0.93, 0.85, 0.76, 0.68, 0.6, 0.55],
        },
      },
      subgroups: [
        {
          name: "High eosinophil + prior hospitalizations",
          size: 87,
          response_rate: 0.78,
          baseline_rate: 0.42,
        },
      ],
    };

    fs.writeFileSync(outPath, JSON.stringify(dummyResult, null, 2));

    return res.json({ job_id, status: "ok" });
  } catch (err) {
    console.error("POST /upload failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /results?job_id=xxxx
 * Returns the R analysis JSON previously written by /upload.
 */
app.get("/results", (req, res) => {
  try {
    const { job_id } = req.query;
    if (!job_id || typeof job_id !== "string") {
      return res.status(400).json({ error: "job_id query param is required" });
    }

    const outPath = path.join(RESULTS_DIR, `${job_id}.json`);
    if (!fs.existsSync(outPath)) {
      return res.status(404).json({ error: "job_id not found" });
    }

    const data = JSON.parse(fs.readFileSync(outPath, "utf8"));
    return res.json(data);
  } catch (err) {
    console.error("GET /results failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /interpret
 * Body: the R results JSON (same shape as GET /results returns).
 * Returns: { interpretation: "plain-English paragraph..." }
 *
 * TODO (Gemini integration):
 *   - Put your key in backend/.env as GEMINI_API_KEY=... (.env is gitignored).
 *   - npm install @google/generative-ai
 *   - const { GoogleGenerativeAI } = require("@google/generative-ai");
 *     const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
 *     const model = genai.getGenerativeModel({ model: "gemini-1.5-flash" });
 *     const prompt = buildClinicalPrompt(req.body);
 *     const r = await model.generateContent(prompt);
 *     return res.json({ interpretation: r.response.text() });
 */
app.post("/interpret", async (req, res) => {
  try {
    const results = req.body;
    if (!results || typeof results !== "object") {
      return res.status(400).json({ error: "expected results JSON in body" });
    }

    // TODO: replace with real Gemini call (see block comment above).
    const dummy =
      "Children with elevated eosinophil counts and two or more prior " +
      "hospitalizations responded to dupilumab at roughly 1.8x the overall " +
      "trial response rate. A prospective enrichment trial targeting this " +
      "subgroup could materially improve efficacy outcomes. (placeholder)";

    return res.json({ interpretation: dummy });
  } catch (err) {
    console.error("POST /interpret failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// 404 fallthrough for any route we didn't define.
app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
