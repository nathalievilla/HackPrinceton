/**
 * Pipeline orchestration (HF Gemma two-agent flow).
 *
 * IMPORTANT (agent guardrail):
 *   - Stage names here MUST match the ones declared in jobs.js STAGES.
 *   - Each stage updates the job state via the jobs module so React polling
 *     sees consistent progress.
 *   - All AI calls go through agents.js (which uses hf.js). All R execution
 *     goes through runner.js (called by agents.js). Do not bypass either.
 *   - All Supabase writes go through db.js. Do not import the SDK here.
 *   - On any failure, call failStage and return; do NOT throw to the caller.
 */

const fs = require("fs");
const path = require("path");

const jobs = require("./jobs");
const validators = require("./validators");
const agents = require("./agents");
const db = require("./db");

function readCsvMetadata(csvPath) {
  try {
    const raw = fs.readFileSync(csvPath, "utf8");
    const lines = raw.split(/\r?\n/);
    const header = (lines[0] || "").split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const dataLines = lines.slice(1).filter(Boolean);
    return {
      columns: header,
      sample_rows: dataLines.slice(0, 5),
      row_count: dataLines.length,
    };
  } catch (err) {
    return { columns: [], sample_rows: [], row_count: 0, read_error: err.message };
  }
}

<<<<<<< Updated upstream
// supabase is passed in from server.js (service role client).
// It is optional — if not provided, the summary patch is skipped gracefully.
async function runPipeline({ job_id, csvPath, jobDir, resultsPath, reportPath, supabase }) {
  // 1. Validate the upload
=======
async function runPipeline({ job_id, csvPath, jobDir, resultsPath, reportPath }) {
  // Stage 0: validate the upload (already partially done in /upload, repeated for safety).
>>>>>>> Stashed changes
  const csvCheck = validators.validateUploadedCsv(csvPath);
  if (!csvCheck.ok) {
    return jobs.failStage(job_id, "uploaded", {
      message: "uploaded CSV failed validation",
      details: csvCheck.errors,
    });
  }
  const csvMeta = readCsvMetadata(csvPath);

  // Persist the upload row in Supabase (no-op if Supabase not configured).
  await db.saveCsvUpload({
    job_id,
    original_filename: path.basename(csvPath),
    row_count: csvMeta.row_count,
    columns: csvMeta.columns,
  });

  // ---------------- Agent 1: biostatistician ----------------
  jobs.startStage(job_id, "agent1_planning");
  let agent1;
  try {
    agent1 = await agents.runAgent1({ csvMeta, csvPath, jobDir });
  } catch (err) {
    return jobs.failStage(job_id, "agent1_planning", { message: err.message });
  }

  if (!agent1.output) {
    return jobs.failStage(job_id, "agent1_planning", {
      message: "Agent 1 failed to produce a usable analysis output",
      details: agent1.execution,
    });
  }

  jobs.setArtifact(job_id, "r_script_path", path.join(jobDir, "analyze.R"));
  jobs.setArtifact(job_id, "r_output_path", path.join(jobDir, "output.json"));
  jobs.finishStage(job_id, "agent1_planning", {
    message: `Agent 1 ok via ${agent1.provider}${agent1.execution.synthetic ? " (synthetic R)" : ""}`,
  });

  // Persist Agent 1 separately for audit.
  await db.saveAgent1Output(job_id, {
    r_code: agent1.r_code,
    output: agent1.output,
    execution: agent1.execution,
    provider: agent1.provider,
    model: agent1.model,
  });

  // ---------------- QA: schema validation ----------------
  jobs.startStage(job_id, "qa_validation");
  const outCheck = validators.validateRRunOutput(agent1.output);
  if (!outCheck.ok) {
    return jobs.failStage(job_id, "qa_validation", {
      message: "Agent 1 output failed schema validation",
      details: outCheck.errors,
    });
  }
  jobs.finishStage(job_id, "qa_validation", {
    message: `${validators.REQUIRED_OUTPUT_KEYS.length} required keys present`,
  });

  // Persist results JSON for GET /results/:job_id
  const resultsPayload = {
    job_id,
    summary: null,                       // filled in after Agent 2
    summary_provider: null,
    agent1_provider: agent1.provider,
    agent1_model: agent1.model,
    execution: agent1.execution,
    ...agent1.output,
  };
  fs.writeFileSync(resultsPath, JSON.stringify(resultsPayload, null, 2));

  // ---------------- Agent 2: manager / QC ----------------
  jobs.startStage(job_id, "agent2_review");
  let agent2;
  try {
    agent2 = await agents.runAgent2(agent1.output);
  } catch (err) {
    return jobs.failStage(job_id, "agent2_review", { message: err.message });
  }
  jobs.finishStage(job_id, "agent2_review", {
    message: `Agent 2 ok via ${agent2.provider}; ${agent2.flags.length} flag(s)`,
  });

  await db.saveAgent2Output(job_id, {
    clinically_reasonable: agent2.clinically_reasonable,
    flags: agent2.flags,
    summary: agent2.summary,
    provider: agent2.provider,
    model: agent2.model,
  });

  // Update results JSON with the final summary now that Agent 2 has run.
  resultsPayload.summary = agent2.summary;
  resultsPayload.summary_provider = agent2.provider;
  fs.writeFileSync(resultsPath, JSON.stringify(resultsPayload, null, 2));

  // ---------------- Final report ----------------
  const reportPayload = {
    job_id,
    generated_at: new Date().toISOString(),
    headline: agent2.summary,
    summary_provider: agent2.provider,
    agent1: {
      provider: agent1.provider,
      model: agent1.model,
      execution: agent1.execution,
      used_fallback_reason: agent1.used_fallback_reason || null,
    },
    agent2: {
      provider: agent2.provider,
      model: agent2.model,
      clinically_reasonable: agent2.clinically_reasonable,
      flags: agent2.flags,
      used_fallback_reason: agent2.used_fallback_reason || null,
    },
    manager_check: {
      clinically_reasonable: agent2.clinically_reasonable,
      flags: agent2.flags,
      notes: "Automated review only. Statistician sign-off required before clinical decisions.",
    },
    results: resultsPayload,
  };
  fs.writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2));
  jobs.setArtifact(job_id, "report_path", reportPath);

<<<<<<< Updated upstream
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
=======
  await db.saveReport(job_id, reportPayload);
>>>>>>> Stashed changes

  jobs.completeJob(job_id);
  await db.upsertJob(jobs.getJob(job_id));
}

module.exports = {
  runPipeline,
};