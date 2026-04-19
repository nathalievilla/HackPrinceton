/**
 * Two-agent orchestration: Gemini "biostatistician" + Gemini "manager".
 *
 * IMPORTANT (agent guardrail):
 *   - All LLM calls go through llm.js; all R execution goes through runner.js.
 *     Do not bypass either.
 *   - Both agents have deterministic fallbacks. The demo MUST keep working
 *     when GEMINI_API_KEY is missing or the API is rate-limited.
 *   - Agent 1 returns a structured bundle including the R code, the parsed
 *     R output, and execution metadata so the pipeline can persist them
 *     separately in Supabase (audit requirement).
 */

const fs = require("fs");
const path = require("path");

const llm = require("./llm");
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
 *   provider: "gemini" | "fallback",
 *   model?: string,
 *   r_code: string,
 *   output: object,
 *   execution: object,
 *   used_fallback_reason?: string
 * }>}
 */
async function runAgent1({ csvMeta, csvPath, jobDir }) {
  console.log('\n🔬 [AGENT1] Starting biostatistician agent...');
  let rCode = null;
  let provider = "fallback";
  let model = null;
  let fallbackReason = null;

  // Try to generate R code using the LLM
  try {
    console.log('📋 [AGENT1] Generating analysis plan...');
    const plan = await llm.generateAnalysisPlan(csvMeta);
    console.log(`✅ [AGENT1] Analysis plan generated via ${plan.provider}`);
    
    console.log('⚙️ [AGENT1] Generating R code from plan...');
    const codeResult = await llm.generateRCode(plan, csvMeta);
    console.log(`✅ [AGENT1] R code generated via ${codeResult.provider}`);
    
    if (codeResult.provider !== "fallback") {
      const candidate = stripMarkdownFences(codeResult.r_code);
      if (looksLikeValidRScript(candidate)) {
        rCode = candidate;
        provider = codeResult.provider;
        model = "gemini";
        console.log('✅ [AGENT1] R code validation passed');
      } else {
        fallbackReason = "model output did not look like a valid R script";
        console.log('⚠️ [AGENT1] R code validation failed');
      }
    } else {
      rCode = codeResult.r_code; // Use fallback R code
      fallbackReason = "LLM provider not configured or failed";
      console.log('📝 [AGENT1] Using fallback R code');
    }
  } catch (error) {
    fallbackReason = `LLM call failed: ${error.message}`;
    console.log('❌ [AGENT1] Error generating code:', error.message);
  }

  if (!rCode) {
    console.log('📝 [AGENT1] No R code generated, using fallback script');
    rCode = fs.readFileSync(FALLBACK_R_PATH, "utf8");
  }

  // Execute R (or use synthetic output if Rscript is not installed).
  console.log('🔄 [AGENT1] Checking R runtime...');
  const runtime = runner.detectRRuntime();
  if (!runtime.available) {
    console.log('⚠️ [AGENT1] R runtime not available, using synthetic output');
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

  console.log('🏃 [AGENT1] Executing R script...');
  const run = await runner.runGeneratedRScript({ jobDir, rCode, csvPath });
  if (!run.execution.ok || !run.output) {
    console.log('❌ [AGENT1] R script execution failed, trying fallback...');
    // Retry once with the deterministic fallback script if the model script failed.
    if (provider === "gemini") {
      const fallbackCode = fs.readFileSync(FALLBACK_R_PATH, "utf8");
      console.log('🔄 [AGENT1] Retrying with fallback R script...');
      const fallbackRun = await runner.runGeneratedRScript({
        jobDir,
        rCode: fallbackCode,
        csvPath,
      });
      if (fallbackRun.execution.ok && fallbackRun.output) {
        console.log('✅ [AGENT1] Fallback R script succeeded');
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
    console.log('❌ [AGENT1] Both primary and fallback R scripts failed');
    return {
      provider,
      model,
      r_code: rCode,
      output: null,
      execution: run.execution,
      used_fallback_reason: fallbackReason || run.execution.error || run.parse_error,
    };
  }

  console.log('✅ [AGENT1] R script execution successful');
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
    demographics: {
      total_patients: 1000,
      arms: [
        { name: "Control", n: 500, age_mean: 45.2, age_sd: 12.1 },
        { name: "Treatment", n: 500, age_mean: 44.8, age_sd: 11.8 }
      ],
      baseline_characteristics: "Synthetic baseline table generated for demo purposes."
    },
    efficacy: {
      primary_endpoint: "Response Rate",
      control_rate: 0.35,
      treatment_rate: 0.52,
      odds_ratio: 2.1,
      p_value: 0.003,
      confidence_interval: "[1.4, 3.2]"
    },
    data_cleaning: {
      original_rows: 1000,
      final_rows: 995,
      excluded_rows: 5,
      exclusion_reasons: ["Missing outcome data", "Protocol violations"],
      imputed_values: 12,
      quality_score: "High"
    },
    shap: {
      features: ["age", "treatment", "baseline_score"],
      importance: [0.5, 0.3, 0.2],
    },
    survival: {
      time_points: [0, 4, 8, 12, 16, 20, 24],
      curves: {
        overall: [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7],
        control: [1.0, 0.92, 0.84, 0.76, 0.68, 0.60, 0.55],
        treatment: [1.0, 0.98, 0.96, 0.94, 0.92, 0.90, 0.85]
      },
    },
    subgroups: [
      {
        name: "Overall cohort (synthetic)",
        size: 995,
        response_rate: 0.44,
        baseline_rate: 0.35,
      },
      {
        name: "Age ≥ 65 years",
        size: 156,
        response_rate: 0.38,
        baseline_rate: 0.35,
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
 *   provider: "gemini" | "fallback",
 *   model?: string,
 *   clinically_reasonable: boolean,
 *   flags: Array<{severity: string, message: string}>,
 *   summary: string,
 *   used_fallback_reason?: string
 * }>}
 */
async function runAgent2(agent1Output) {
  console.log('\n👨‍💼 [AGENT2] Starting manager/QC agent...');
  if (!agent1Output) {
    console.log('❌ [AGENT2] No Agent1 output provided');
    const det = deterministicManagerCheck({});
    return { provider: "fallback", ...det, used_fallback_reason: "no agent1 output" };
  }

  try {
    console.log('📝 [AGENT2] Generating summary...');
    // Try to get summary and manager check using LLM
    const summaryResult = await llm.generateSummary(agent1Output);
    console.log(`✅ [AGENT2] Summary generated via ${summaryResult.provider}`);
    
    console.log('🔍 [AGENT2] Running manager check...');
    const managerResult = await llm.managerCheck(agent1Output);
    console.log(`✅ [AGENT2] Manager check completed via ${managerResult.provider}`);
    
    if (summaryResult.provider !== "fallback" && managerResult.provider !== "fallback") {
      console.log(`✅ [AGENT2] Both summary and manager check successful via ${summaryResult.provider}`);
      return {
        provider: summaryResult.provider,
        model: summaryResult.provider,
        clinically_reasonable: managerResult.clinically_reasonable,
        flags: managerResult.flags,
        summary: summaryResult.summary,
        overall_assessment: managerResult.overall_assessment,
        recommendations: managerResult.recommendations,
        notes: managerResult.notes,
      };
    }
    
    console.log('⚠️ [AGENT2] One or both LLM calls failed, using fallback with partial results');
    // If either failed, use fallback but try to use any successful parts
    const det = deterministicManagerCheck(agent1Output);
    return { 
      provider: "fallback", 
      model: "gemini", 
      ...det, 
      summary: summaryResult.provider !== "fallback" ? summaryResult.summary : det.summary,
      overall_assessment: managerResult.overall_assessment || "Analysis completed with fallback processing.",
      recommendations: managerResult.recommendations || ["Review analysis with senior biostatistician."],
      notes: managerResult.notes || "Automated review only. Statistician sign-off required before clinical decisions.",
      used_fallback_reason: "LLM provider not configured or failed" 
    };
  } catch (error) {
    console.log('❌ [AGENT2] Error during agent processing:', error.message);
    const det = deterministicManagerCheck(agent1Output);
    return { 
      provider: "fallback", 
      ...det, 
      overall_assessment: "Analysis completed with fallback processing due to error.",
      recommendations: ["Review analysis with senior biostatistician.", "Investigate LLM integration issues."],
      notes: "Automated review only. Statistician sign-off required before clinical decisions.",
      used_fallback_reason: `LLM call failed: ${error.message}` 
    };
  }
}

module.exports = {
  AGENT1_SYSTEM,
  AGENT2_SYSTEM,
  runAgent1,
  runAgent2,
};
