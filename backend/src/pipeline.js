/**
 * Pipeline orchestration.
 *
 * IMPORTANT (agent guardrail):
 *   - Stage names here MUST match the ones declared in jobs.js STAGES.
 *   - Each stage updates the job state via the jobs module so React polling
 *     sees consistent progress.
 *   - All AI calls go through llm.js. All R execution goes through runner.js.
 *     Do not bypass either.
 *   - On any failure, call failStage and return; do NOT throw to the caller.
 */

const fs = require("fs");
const path = require("path");

const jobs = require("./jobs");
const runner = require("./runner");
const validators = require("./validators");
const llm = require("./llm");

const MAX_R_RETRIES = 1; // total attempts = MAX_R_RETRIES + 1

function readCsvMetadata(csvPath) {
  try {
    const sample = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).slice(0, 5);
    const header = (sample[0] || "").split(",").map((c) => c.trim());
    return { columns: header, sample_rows: sample.slice(1).filter(Boolean) };
  } catch (err) {
    return { columns: [], sample_rows: [], read_error: err.message };
  }
}

// supabase is passed in from server.js (service role client).
// It is optional — if not provided, the summary patch is skipped gracefully.
async function runPipeline({ job_id, csvPath, jobDir, resultsPath, reportPath, supabase }) {
  // 1. Validate the upload
  const csvCheck = validators.validateUploadedCsv(csvPath);
  if (!csvCheck.ok) {
    return jobs.failStage(job_id, "uploaded", {
      message: "uploaded CSV failed validation",
      details: csvCheck.errors,
    });
  }
  const csvMeta = readCsvMetadata(csvPath);

  // 2. AI proposes an analysis plan
  jobs.startStage(job_id, "ai_plan_generated");
  let plan;
  try {
    plan = await llm.generateAnalysisPlan(csvMeta);
    jobs.finishStage(job_id, "ai_plan_generated", {
      message: `${plan.plan.length} step plan via ${plan.provider}`,
    });
  } catch (err) {
    return jobs.failStage(job_id, "ai_plan_generated", { message: err.message });
  }

  // 3. AI generates R code (currently a baseline; replace via llm.js)
  jobs.startStage(job_id, "r_code_generated");
  let rCodeBundle;
  try {
    rCodeBundle = await llm.generateRCode(plan, csvMeta);
    jobs.finishStage(job_id, "r_code_generated", {
      message: `R code via ${rCodeBundle.provider}`,
    });
  } catch (err) {
    return jobs.failStage(job_id, "r_code_generated", { message: err.message });
  }

  // 4. Execute R with bounded retries
  jobs.startStage(job_id, "r_execution_done");
  const runtime = runner.detectRRuntime();
  let runResult = null;
  if (runtime.available) {
    let attempts = 0;
    let lastError = null;
    while (attempts <= MAX_R_RETRIES) {
      attempts += 1;
      runResult = await runner.runGeneratedRScript({
        jobDir,
        rCode: rCodeBundle.r_code,
        csvPath,
      });
      if (runResult.execution.ok && runResult.output) break;
      lastError = runResult.execution.error || runResult.parse_error || "r_failed";
    }
    if (!runResult || !runResult.execution.ok || !runResult.output) {
      return jobs.failStage(job_id, "r_execution_done", {
        message: `R execution failed after ${attempts} attempt(s): ${lastError}`,
        details: runResult ? runResult.execution : null,
      });
    }
    jobs.setArtifact(job_id, "r_script_path", runResult.script_path);
    jobs.setArtifact(job_id, "r_output_path", runResult.output_path);
    jobs.finishStage(job_id, "r_execution_done", {
      message: `R run ok in ${runResult.execution.runtime_ms} ms`,
    });
  } else {
    runResult = {
      output: syntheticROutput(),
      execution: {
        ok: true,
        exit_code: 0,
        runtime_ms: 0,
        timed_out: false,
        error: null,
        synthetic: true,
        reason: runtime.reason || "Rscript unavailable",
      },
    };
    jobs.finishStage(job_id, "r_execution_done", {
      message: `synthetic output (R unavailable: ${runtime.reason || "unknown"})`,
    });
  }

  // 5. Validate R output
  jobs.startStage(job_id, "qa_checks_done");
  const outCheck = validators.validateRRunOutput(runResult.output);
  if (!outCheck.ok) {
    return jobs.failStage(job_id, "qa_checks_done", {
      message: "R output failed schema validation",
      details: outCheck.errors,
    });
  }
  jobs.finishStage(job_id, "qa_checks_done", {
    message: `${validators.REQUIRED_OUTPUT_KEYS.length} required keys present`,
  });

  // 6. Generate plain-English summary
  let summary;
  try {
    summary = await llm.generateSummary(runResult.output);
  } catch (err) {
    summary = { provider: "fallback", summary: `(summary unavailable: ${err.message})` };
  }

  // Persist results JSON for GET /results/:job_id
  const resultsPayload = {
    job_id,
    plan: plan.plan,
    summary: summary.summary,
    summary_provider: summary.provider,
    execution: runResult.execution,
    ...runResult.output,
  };
  fs.writeFileSync(resultsPath, JSON.stringify(resultsPayload, null, 2));

  // 7. Manager check
  jobs.startStage(job_id, "manager_review_done");
  let managerReview;
  try {
    managerReview = await llm.managerCheck(runResult.output);
    jobs.finishStage(job_id, "manager_review_done", {
      message: `${managerReview.flags.length} flag(s) raised`,
    });
  } catch (err) {
    return jobs.failStage(job_id, "manager_review_done", { message: err.message });
  }

  // 8. Final report
  const reportPayload = {
    job_id,
    generated_at: new Date().toISOString(),
    headline: summary.summary,
    summary_provider: summary.provider,
    manager_check: managerReview,
    plan: plan.plan,
    results: resultsPayload,
  };
  fs.writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2));
  jobs.setArtifact(job_id, "report_path", reportPath);

  jobs.completeJob(job_id);

  // 9. Patch the summary back into Supabase now that we have it.
  // The row was already inserted in server.js with summary: null.
  // This updates only the summary field — all other fields stay as-is.
  if (supabase) {
    const { error: patchError } = await supabase
      .from("csv_uploads")
      .update({ summary: summary.summary })
      .eq("job_id", job_id);
    if (patchError) {
      console.error(`Supabase summary patch failed for job ${job_id}:`, patchError.message);
    }
  }
}

function syntheticROutput() {
  return {
    meta: { synthetic: true },
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
}

module.exports = {
  runPipeline,
};