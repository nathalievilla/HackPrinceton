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
 *     deterministic) and "huggingface" (uses Gemma 4 via HF Inference API).
 */

const { HfInference } = require("@huggingface/inference");

const PROVIDER = (process.env.LLM_PROVIDER || "fallback").toLowerCase();
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY || "";
const HF_MODEL = process.env.HF_MODEL || "google/gemma-2-9b-it"; // Default: Gemma 2 9B (instruction-tuned)

let hfClient = null;
if (PROVIDER === "huggingface" && HF_API_KEY) {
  hfClient = new HfInference(HF_API_KEY);
}

async function generateAnalysisPlan(csvMeta) {
  const cols = (csvMeta && csvMeta.columns) || [];
  
  if (PROVIDER === "huggingface" && hfClient) {
    try {
      const prompt = `You are a biostatistician. Analyze a clinical trial CSV with columns: ${cols.join(", ")}.
      
Create a structured analysis plan with 5 steps for identifying patient subgroups that respond better to treatment. Return JSON with: {"plan": ["step1", "step2", ...], "target_columns": [...]}. Be specific about which columns to use.`;
      
      const response = await hfClient.textGeneration({
        model: HF_MODEL,
        inputs: prompt,
        parameters: {
          max_new_tokens: 500,
          temperature: 0.3,
        },
      });
      
      // Try to extract JSON from response
      const text = response.generated_text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          provider: "huggingface",
          plan: parsed.plan || [],
          target_columns: parsed.target_columns || cols,
        };
      }
    } catch (err) {
      console.error("Gemma analysis plan generation failed:", err.message);
      // Fall through to fallback
    }
  }
  
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
  const fs = require("fs");
  const path = require("path");
  
  if (PROVIDER === "huggingface" && hfClient) {
    try {
      const planText = (plan && plan.plan) ? plan.plan.join("\n") : "";
      const prompt = `You are an R biostatistics expert. Generate R code for a clinical trial analysis.
      
Columns: ${(csvMeta && csvMeta.columns || []).join(", ")}
Analysis plan: ${planText}

Write R code that:
1. Loads the CSV from args[1]
2. Computes SHAP feature importance, survival curves, and identifies subgroups
3. Outputs JSON to args[2] with keys: shap (features, importance), survival (time_points, curves), subgroups (name, size, response_rate, baseline_rate)

Return only valid R code, no explanation.`;
      
      const response = await hfClient.textGeneration({
        model: HF_MODEL,
        inputs: prompt,
        parameters: {
          max_new_tokens: 2000,
          temperature: 0.2,
        },
      });
      
      const rCode = response.generated_text || "";
      if (rCode.length > 100) {
        return {
          provider: "huggingface",
          r_code: rCode,
          based_on_plan: !!plan,
        };
      }
    } catch (err) {
      console.error("Gemma R code generation failed:", err.message);
      // Fall through to fallback
    }
  }
  
  // Fallback: use baseline analyze.R if it exists
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
  
  if (PROVIDER === "huggingface" && hfClient) {
    try {
      const subgroupsText = (results && results.subgroups)
        ? JSON.stringify(results.subgroups.slice(0, 3))
        : "No standout subgroups";
      const shapText = (results && results.shap)
        ? `Top features: ${(results.shap.features || []).slice(0, 5).join(", ")}`
        : "";
      
      const prompt = `Write a clinical summary for a biostatistician in 2-3 sentences. The analysis found:\nSubgroups: ${subgroupsText}\n${shapText}\n\nMake it specific and actionable for trial design decisions.`;
      
      const response = await hfClient.textGeneration({
        model: HF_MODEL,
        inputs: prompt,
        parameters: {
          max_new_tokens: 300,
          temperature: 0.5,
        },
      });
      
      const summary = response.generated_text || "";
      if (summary.length > 50) {
        return { provider: "huggingface", summary: summary.trim() };
      }
    } catch (err) {
      console.error("Gemma summary generation failed:", err.message);
      // Fall through to fallback
    }
  }
  
  const text = subgroup
    ? `${subgroup.name} (n=${subgroup.size}) responded at ${(subgroup.response_rate * 100).toFixed(0)}% vs a baseline of ${(subgroup.baseline_rate * 100).toFixed(0)}%, suggesting a candidate enrichment subgroup worth prospective evaluation.`
    : "Analysis completed but no standout subgroup was identified above the 1.5x baseline threshold.";
  return { provider: "fallback", summary: text };
}

async function managerCheck(results) {
  const flags = [];
  const subgroups = (results && results.subgroups) || [];
  
  // Baseline rule-based checks
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
  
  // Gemma-powered clinical review
  if (PROVIDER === "huggingface" && hfClient) {
    try {
      const resultsText = JSON.stringify({
        subgroup_count: subgroups.length,
        top_subgroups: subgroups.slice(0, 2),
        rule_flags: flags.length,
      });
      
      const prompt = `You are a clinical biostatistics reviewer. Review these trial analysis results and identify any red flags or concerns (in JSON):\n${resultsText}\n\nReturn JSON: {"additional_flags": [{"severity": "warning|info", "message": "..."}], "overall_risk": "low|medium|high"}`;
      
      const response = await hfClient.textGeneration({
        model: HF_MODEL,
        inputs: prompt,
        parameters: {
          max_new_tokens: 400,
          temperature: 0.3,
        },
      });
      
      const text = response.generated_text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.additional_flags && Array.isArray(parsed.additional_flags)) {
          flags.push(...parsed.additional_flags);
        }
      }
    } catch (err) {
      console.error("Gemma manager check failed:", err.message);
      // Continue with rule-based checks only
    }
  }

  return {
    provider: PROVIDER === "huggingface" ? "huggingface" : "fallback",
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
