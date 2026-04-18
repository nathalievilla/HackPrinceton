/**
 * Provider-agnostic LLM wrapper.
 *
 * IMPORTANT (agent guardrail):
 *   - Always go through `generateAnalysisPlan`, `generateRCode`,
 *     `generateSummary`, and `managerCheck`. Do not call provider SDKs from
 *     pipeline.js or routes.
 *   - Every function MUST return a deterministic fallback if no provider is
 *     configured or the call fails. The demo cannot crash because the AI is
 *     down.
 *   - LLM_PROVIDER is read from env. Currently supported: "fallback" (always
 *     deterministic). Hooks for "gemini" and "gradient" are stubbed so a
 *     teammate can wire a real provider without changing pipeline.js.
 */

const PROVIDER = (process.env.LLM_PROVIDER || "fallback").toLowerCase();

async function generateAnalysisPlan(csvMeta) {
  const cols = (csvMeta && csvMeta.columns) || [];
  return {
    provider: "fallback",
    plan: [
      "Profile the CSV (n rows, column types, missingness).",
      "Fit a baseline response model (logistic regression on treatment + key covariates).",
      "Compute SHAP-style feature importance approximations.",
      "Build Kaplan-Meier survival curves split by treatment arm and key subgroups.",
      "Identify subgroups with response_rate >= 1.5x baseline.",
    ],
    target_columns: cols,
  };
}

async function generateRCode(plan, csvMeta) {
  // Always returns the baseline analyze.R contents. A real LLM hook can replace
  // this with a generated script, but it MUST still write JSON to args[2] with
  // the keys validators.js expects.
  const fs = require("fs");
  const path = require("path");
  const baselinePath = path.join(__dirname, "..", "r", "analyze.R");
  if (fs.existsSync(baselinePath)) {
    return {
      provider: "fallback",
      r_code: fs.readFileSync(baselinePath, "utf8"),
      based_on_plan: !!plan,
    };
  }
  return { provider: "fallback", r_code: MINIMAL_R, based_on_plan: false };
}

async function generateSummary(results) {
  const subgroup = pickHeadlineSubgroup(results);
  const text = subgroup
    ? `${subgroup.name} (n=${subgroup.size}) responded at ${(subgroup.response_rate * 100).toFixed(0)}% vs a baseline of ${(subgroup.baseline_rate * 100).toFixed(0)}%, suggesting a candidate enrichment subgroup worth prospective evaluation.`
    : "Analysis completed but no standout subgroup was identified above the 1.5x baseline threshold.";
  return { provider: "fallback", summary: text };
}

async function managerCheck(results) {
  const flags = [];
  const subgroups = (results && results.subgroups) || [];
  for (const s of subgroups) {
    if (typeof s.size === "number" && s.size < 30) {
      flags.push({
        severity: "warning",
        subgroup: s.name,
        message: `Subgroup size ${s.size} is below the recommended minimum (30) for stable inference.`,
      });
    }
    if (
      typeof s.response_rate === "number" &&
      typeof s.baseline_rate === "number" &&
      s.response_rate > 0.95
    ) {
      flags.push({
        severity: "warning",
        subgroup: s.name,
        message: `Response rate ${(s.response_rate * 100).toFixed(0)}% is suspiciously high; verify outcome definition and possible label leakage.`,
      });
    }
  }

  const shap = results && results.shap;
  if (shap && Array.isArray(shap.importance)) {
    const sum = shap.importance.reduce((a, b) => a + (b || 0), 0);
    if (sum > 1.05) {
      flags.push({
        severity: "info",
        message: `SHAP importance values sum to ${sum.toFixed(2)}; consider normalizing for clearer reporting.`,
      });
    }
  }

  return {
    provider: "fallback",
    clinically_reasonable: flags.filter((f) => f.severity === "warning").length === 0,
    flags,
    notes:
      "Automated review only. Statistician sign-off required before clinical decisions.",
  };
}

function pickHeadlineSubgroup(results) {
  const subs = (results && results.subgroups) || [];
  if (!subs.length) return null;
  return subs
    .filter(
      (s) =>
        typeof s.response_rate === "number" && typeof s.baseline_rate === "number"
    )
    .sort(
      (a, b) =>
        b.response_rate - b.baseline_rate - (a.response_rate - a.baseline_rate)
    )[0];
}

const MINIMAL_R = `args <- commandArgs(trailingOnly = TRUE)
csv_path <- args[1]
out_path <- args[2]
out <- list(shap = list(features = list(), importance = list()),
            survival = list(time_points = list(), curves = list()),
            subgroups = list())
writeLines(jsonlite::toJSON(out, auto_unbox = TRUE), out_path)
`;

module.exports = {
  PROVIDER,
  generateAnalysisPlan,
  generateRCode,
  generateSummary,
  managerCheck,
};
