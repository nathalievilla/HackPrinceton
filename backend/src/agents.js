/**
 * Two-agent orchestration: Gemma "biostatistician" + Gemma "manager".
 *
 * IMPORTANT (agent guardrail):
 *   - All Gemma calls go through hf.js; all R execution goes through runner.js.
 *     Do not bypass either.
 *   - Both agents have deterministic fallbacks. The demo MUST keep working
 *     when HF_TOKEN is missing or the API is rate-limited.
 *   - Agent 1 returns a structured bundle including the R code, the parsed
 *     R output, and execution metadata so the pipeline can persist them
 *     separately in Supabase (audit requirement).
 */

const fs = require("fs");
const path = require("path");

const hf = require("./hf");
const runner = require("./runner");

const FALLBACK_R_PATH = path.join(__dirname, "..", "r", "analyze_fallback.R");

// ----------------- Agent 1: biostatistician -----------------

const AGENT1_SYSTEM = `You are a senior biostatistician at a clinical research organization.
You are given metadata about a CSV of patient-level clinical trial data.
Your job: emit a single, complete R script that performs subgroup and survival
analysis on this CSV.

Hard requirements for the script:
- Read the CSV path from commandArgs(trailingOnly = TRUE)[1].
- Write a JSON file to commandArgs(trailingOnly = TRUE)[2] using jsonlite::toJSON
  with auto_unbox = TRUE.
- The output JSON MUST have these top-level keys (extra keys are fine):
    shap:    { features: <string[]>, importance: <number[]> }
    survival:{ time_points: <number[]>, curves: { <name>: <number[]> } }
    subgroups: [ { name, size, response_rate, baseline_rate } ]
- No network calls. No file writes outside the args[2] path.
- Use base R + jsonlite only (assume nothing else is installed).
- Wrap risky parsing in tryCatch so the script never crashes silently.

Return ONLY the R code, with no markdown fences or commentary. The first line
must be valid R.`;

function buildAgent1UserPrompt(csvMeta) {
  const cols = (csvMeta?.columns || []).join(", ") || "(unknown)";
  const rows = csvMeta?.row_count ?? "(unknown)";
  return `CSV columns: ${cols}
Row count: ${rows}
Trial context: ACTG 175 (HIV, Phase 3, treatment column "trt", outcome column "label").

Please produce the R analysis script described in the system message.`;
}

function stripMarkdownFences(text) {
  if (!text) return "";
  // Remove ```r ... ``` or ``` ... ``` fences if the model included them.
  return text
    .replace(/^\s*```(?:r|R)?\s*\n?/m, "")
    .replace(/```\s*$/m, "")
    .trim();
}

function looksLikeValidRScript(code) {
  if (!code || code.length < 40) return false;
  if (!/commandArgs\s*\(/.test(code)) return false;
  if (!/(writeLines|cat|jsonlite::toJSON|toJSON)/.test(code)) return false;
  return true;
}

/**
 * @param {{ csvMeta: {columns:string[], row_count:number}, csvPath: string, jobDir: string }} args
 * @returns {Promise<{
 *   provider: "huggingface" | "fallback",
 *   model?: string,
 *   r_code: string,
 *   output: object,
 *   execution: object,
 *   used_fallback_reason?: string
 * }>}
 */
async function runAgent1({ csvMeta, csvPath, jobDir }) {
  let rCode = null;
  let provider = "fallback";
  let model = null;
  let fallbackReason = null;

  if (hf.isConfigured()) {
    const hfResult = await hf.callGemma([
      { role: "system", content: AGENT1_SYSTEM },
      { role: "user", content: buildAgent1UserPrompt(csvMeta) },
    ], { max_tokens: 1500, temperature: 0.2 });

    if (hfResult.ok) {
      const candidate = stripMarkdownFences(hfResult.text);
      if (looksLikeValidRScript(candidate)) {
        rCode = candidate;
        provider = "huggingface";
        model = hfResult.model;
      } else {
        fallbackReason = "model output did not look like a valid R script";
      }
    } else {
      fallbackReason = `HF call failed: ${hfResult.error}`;
    }
  } else {
    fallbackReason = "HF_TOKEN not configured";
  }

  if (!rCode) {
    rCode = fs.readFileSync(FALLBACK_R_PATH, "utf8");
  }

  // Execute R (or use synthetic output if Rscript is not installed).
  const runtime = runner.detectRRuntime();
  if (!runtime.available) {
    return {
      provider,
      model,
      r_code: rCode,
      output: syntheticAgent1Output(),
      execution: {
        ok: true,
        exit_code: 0,
        runtime_ms: 0,
        synthetic: true,
        reason: runtime.reason || "Rscript unavailable",
      },
      used_fallback_reason: fallbackReason,
    };
  }

  const run = await runner.runGeneratedRScript({ jobDir, rCode, csvPath });
  if (!run.execution.ok || !run.output) {
    // Retry once with the deterministic fallback script if the model script failed.
    if (provider === "huggingface") {
      const fallbackCode = fs.readFileSync(FALLBACK_R_PATH, "utf8");
      const fallbackRun = await runner.runGeneratedRScript({
        jobDir,
        rCode: fallbackCode,
        csvPath,
      });
      if (fallbackRun.execution.ok && fallbackRun.output) {
        return {
          provider: "fallback",
          model,
          r_code: fallbackCode,
          output: fallbackRun.output,
          execution: fallbackRun.execution,
          used_fallback_reason: `agent R script failed: ${run.execution.error || run.parse_error}`,
        };
      }
    }
    return {
      provider,
      model,
      r_code: rCode,
      output: null,
      execution: run.execution,
      used_fallback_reason: fallbackReason || run.execution.error || run.parse_error,
    };
  }

  return {
    provider,
    model,
    r_code: rCode,
    output: run.output,
    execution: run.execution,
    used_fallback_reason: fallbackReason,
  };
}

function syntheticAgent1Output() {
  return {
    meta: { synthetic: true, source: "agent1_synthetic" },
    shap: {
      features: ["age", "trt", "label"],
      importance: [0.5, 0.3, 0.2],
    },
    survival: {
      time_points: [0, 4, 8, 12, 16, 20, 24],
      curves: {
        overall: [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7],
      },
    },
    subgroups: [
      {
        name: "Overall cohort (synthetic)",
        size: 0,
        response_rate: 0.5,
        baseline_rate: 0.5,
      },
    ],
  };
}

// ----------------- Agent 2: manager / QC -----------------

const AGENT2_SYSTEM = `You are the senior manager of a biostatistics team at a clinical
research organization. You review the JSON output of an analysis your junior
just produced.

Your job: return a single JSON object (no markdown, no commentary) with these
exact keys:
  clinically_reasonable: boolean
  flags: array of { severity: "info"|"warning"|"error", message: string }
  summary: string  // 2-3 sentences in plain English aimed at a medical
                   // director. Lead with the headline subgroup finding.

Review checklist when constructing flags:
- Subgroup sizes < 30 -> "warning" (low statistical power).
- Response rates > 0.95 or < 0.05 -> "warning" (suspicious; check for label
  leakage or definition issues).
- SHAP importance values that don't sum to ~1 -> "info".
- Anything else that a senior reviewer would flag for the junior.

Return ONLY the JSON object. No prose before or after it.`;

function buildAgent2UserPrompt(agent1Output) {
  return `Here is the analysis JSON to review:

${JSON.stringify(agent1Output, null, 2)}`;
}

function tryParseJsonObject(text) {
  if (!text) return null;
  // Strip markdown fences if the model returned ```json ... ```.
  const cleaned = stripMarkdownFences(text)
    .replace(/^\s*```(?:json)?\s*\n?/m, "")
    .replace(/```\s*$/m, "")
    .trim();
  // Find the first {...} balanced block to be tolerant of leading/trailing prose.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function deterministicManagerCheck(agent1Output) {
  const flags = [];
  const subgroups = (agent1Output && agent1Output.subgroups) || [];
  let headline = null;
  let bestLift = -Infinity;

  for (const s of subgroups) {
    if (typeof s.size === "number" && s.size > 0 && s.size < 30) {
      flags.push({
        severity: "warning",
        message: `Subgroup "${s.name}" size ${s.size} is below the recommended minimum (30) for stable inference.`,
      });
    }
    if (typeof s.response_rate === "number" && (s.response_rate > 0.95 || s.response_rate < 0.05)) {
      flags.push({
        severity: "warning",
        message: `Subgroup "${s.name}" response rate ${(s.response_rate * 100).toFixed(0)}% is suspicious; verify outcome definition.`,
      });
    }
    if (
      typeof s.response_rate === "number" &&
      typeof s.baseline_rate === "number"
    ) {
      const lift = s.response_rate - s.baseline_rate;
      if (lift > bestLift) {
        bestLift = lift;
        headline = s;
      }
    }
  }

  const shap = agent1Output && agent1Output.shap;
  if (shap && Array.isArray(shap.importance)) {
    const sum = shap.importance.reduce((a, b) => a + (b || 0), 0);
    if (sum > 1.05 || (sum > 0 && sum < 0.95)) {
      flags.push({
        severity: "info",
        message: `SHAP importance values sum to ${sum.toFixed(2)}; consider normalizing for clearer reporting.`,
      });
    }
  }

  const summary = headline
    ? `${headline.name} (n=${headline.size}) responded at ${(headline.response_rate * 100).toFixed(0)}% vs a baseline of ${(headline.baseline_rate * 100).toFixed(0)}%. This is the strongest signal in the analysis and warrants a prospective enrichment trial.`
    : "Analysis completed but no standout subgroup was identified above the baseline threshold.";

  return {
    clinically_reasonable: flags.filter((f) => f.severity === "warning").length === 0,
    flags,
    summary,
  };
}

/**
 * @param {object} agent1Output
 * @returns {Promise<{
 *   provider: "huggingface" | "fallback",
 *   model?: string,
 *   clinically_reasonable: boolean,
 *   flags: Array<{severity: string, message: string}>,
 *   summary: string,
 *   used_fallback_reason?: string
 * }>}
 */
async function runAgent2(agent1Output) {
  if (!agent1Output) {
    const det = deterministicManagerCheck({});
    return { provider: "fallback", ...det, used_fallback_reason: "no agent1 output" };
  }

  if (hf.isConfigured()) {
    const hfResult = await hf.callGemma([
      { role: "system", content: AGENT2_SYSTEM },
      { role: "user", content: buildAgent2UserPrompt(agent1Output) },
    ], { max_tokens: 600, temperature: 0.3 });

    if (hfResult.ok) {
      const parsed = tryParseJsonObject(hfResult.text);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.flags) && typeof parsed.summary === "string") {
        return {
          provider: "huggingface",
          model: hfResult.model,
          clinically_reasonable: !!parsed.clinically_reasonable,
          flags: parsed.flags,
          summary: parsed.summary,
        };
      }
      const det = deterministicManagerCheck(agent1Output);
      return { provider: "fallback", model: hfResult.model, ...det, used_fallback_reason: "model output was not valid JSON" };
    }
    const det = deterministicManagerCheck(agent1Output);
    return { provider: "fallback", ...det, used_fallback_reason: `HF call failed: ${hfResult.error}` };
  }

  const det = deterministicManagerCheck(agent1Output);
  return { provider: "fallback", ...det, used_fallback_reason: "HF_TOKEN not configured" };
}

module.exports = {
  AGENT1_SYSTEM,
  AGENT2_SYSTEM,
  runAgent1,
  runAgent2,
};
