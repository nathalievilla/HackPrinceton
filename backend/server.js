const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/analyze", (req, res) => {
  try {
    const { trial_id, trial_context } = req.body ?? {};

    if (!trial_id || typeof trial_id !== "string") {
      return res.status(400).json({ error: "trial_id (string) is required" });
    }

    return res.json({
      status: "ok",
      message: "dummy analysis",
      trial_id,
      result: {
        eligibility_score: 0.87,
        matched_criteria: ["age", "diagnosis"],
        unmatched_criteria: [],
        notes: "Placeholder response. Replace with real analysis output.",
      },
      echo: { trial_context: trial_context ?? null },
    });
  } catch (err) {
    console.error("POST /analyze failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
