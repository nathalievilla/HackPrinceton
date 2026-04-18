require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Middleware
app.use(cors());
app.use(express.json());

// Logger
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Optional: GET /analyze
app.get("/analyze", (_req, res) => {
  res.json({ message: "Use POST for this endpoint" });
});

// POST /analyze
app.post("/analyze", (req, res) => {
  try {
    const { trial_id, trial_context } = req.body ?? {};

    if (!trial_id || typeof trial_id !== "string") {
      return res.status(400).json({
        status: "error",
        error: "trial_id (string) is required"
      });
    }

    return res.json({
      status: "ok",
      trial_id,

      shap_summary: [
        { feature: "eosinophils", importance: 0.42 },
        { feature: "prior_hospitalizations", importance: 0.31 },
        { feature: "age", importance: 0.15 },
        { feature: "severity", importance: 0.12 }
      ],

      subgroup_insight: {
        description: "High eosinophils + prior hospitalizations",
        response_rate: 0.78,
        baseline_rate: 0.55,
        lift: 0.23
      },

      survival_curve: [
        { time: 0, treatment: 1.0, control: 1.0 },
        { time: 30, treatment: 0.92, control: 0.85 },
        { time: 60, treatment: 0.88, control: 0.76 },
        { time: 90, treatment: 0.83, control: 0.70 }
      ],

      ai_interpretation:
        "Children with elevated eosinophil counts and prior hospitalizations showed significantly higher response rates.",

      meta: {
        generated_at: new Date().toISOString(),
        version: "dummy-v1"
      },

      echo: {
        trial_context: trial_context ?? null
      }
    });

  } catch (err) {
    console.error("POST /analyze failed:", err);
    return res.status(500).json({
      status: "error",
      error: "internal_error"
    });
  }
});

// POST /interpret (Gemini)
app.post("/interpret", async (req, res) => {
  try {
    const { shap_summary, subgroup_insight } = req.body ?? {};

    if (!shap_summary || !subgroup_insight) {
      return res.status(400).json({
        error: "shap_summary and subgroup_insight are required"
      });
    }

    const prompt = `
You are a clinical biostatistician.

SHAP feature importance:
${JSON.stringify(shap_summary)}

Subgroup insight:
${JSON.stringify(subgroup_insight)}

Write a concise clinical interpretation (3-4 sentences).
Focus on subgroup benefit and implications for trial design.
`;

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash"
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    return res.json({
      interpretation: text
    });

  } catch (err) {
    console.error("POST /interpret failed:", err);
    return res.status(500).json({
      error: "gemini_failed",
      details: err.message
    });
  }
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    status: "error",
    error: "not_found"
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});