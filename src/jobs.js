/**
 * In-memory job registry + state machine for the React-facing async pipeline.
 *
 * IMPORTANT (agent guardrail):
 *   - The shape of the job object returned by `getJob` is part of the
 *     React-facing API contract. Do not rename `status`, `stage`, `stages[]`,
 *     `progress`, `error`, or `artifacts` without updating AGENTS.md and the
 *     frontend polling code in hack-princeton/src.
 *   - Status lifecycle: queued -> running -> completed | failed.
 *   - Stage names are an ordered enum (see STAGES). React renders a timeline
 *     directly from this list.
 */

const crypto = require("crypto");

const STAGES = Object.freeze([
  "uploaded",
  "ai_plan_generated",
  "r_code_generated",
  "r_execution_done",
  "qa_checks_done",
  "manager_review_done",
  "completed",
]);

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

const jobs = new Map();

function newJobId() {
  return crypto.randomBytes(6).toString("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function createJob({ uploadedFile }) {
  const job_id = newJobId();
  const job = {
    job_id,
    status: "queued",
    stage: "uploaded",
    progress: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
    completed_at: null,
    uploaded_file: uploadedFile,
    stages: STAGES.map((name) => ({
      name,
      status: name === "uploaded" ? "completed" : "pending",
      started_at: name === "uploaded" ? nowIso() : null,
      finished_at: name === "uploaded" ? nowIso() : null,
      message: null,
    })),
    artifacts: {
      r_script_path: null,
      r_output_path: null,
      report_path: null,
    },
    error: null,
  };
  jobs.set(job_id, job);
  return job;
}

function getJob(job_id) {
  return jobs.get(job_id) || null;
}

function listJobs() {
  return Array.from(jobs.values());
}

function _stageIndex(stageName) {
  return STAGES.indexOf(stageName);
}

function startStage(job_id, stageName) {
  const job = jobs.get(job_id);
  if (!job) return;
  job.status = "running";
  job.stage = stageName;
  const stage = job.stages.find((s) => s.name === stageName);
  if (stage) {
    stage.status = "running";
    stage.started_at = nowIso();
  }
  const idx = _stageIndex(stageName);
  if (idx >= 0) {
    job.progress = Math.round((idx / (STAGES.length - 1)) * 100);
  }
  job.updated_at = nowIso();
}

function finishStage(job_id, stageName, { message } = {}) {
  const job = jobs.get(job_id);
  if (!job) return;
  const stage = job.stages.find((s) => s.name === stageName);
  if (stage) {
    stage.status = "completed";
    stage.finished_at = nowIso();
    if (message) stage.message = message;
  }
  job.updated_at = nowIso();
}

function failStage(job_id, stageName, errorObj) {
  const job = jobs.get(job_id);
  if (!job) return;
  const stage = job.stages.find((s) => s.name === stageName);
  if (stage) {
    stage.status = "failed";
    stage.finished_at = nowIso();
    stage.message = errorObj?.message || "stage failed";
  }
  job.status = "failed";
  job.error = {
    stage: stageName,
    message: errorObj?.message || "unknown error",
    details: errorObj?.details || null,
  };
  job.updated_at = nowIso();
  job.completed_at = nowIso();
}

function completeJob(job_id) {
  const job = jobs.get(job_id);
  if (!job) return;
  job.status = "completed";
  job.stage = "completed";
  job.progress = 100;
  job.updated_at = nowIso();
  job.completed_at = nowIso();
  const completedStage = job.stages.find((s) => s.name === "completed");
  if (completedStage) {
    completedStage.status = "completed";
    completedStage.started_at = completedStage.started_at || nowIso();
    completedStage.finished_at = nowIso();
  }
}

function setArtifact(job_id, key, value) {
  const job = jobs.get(job_id);
  if (!job) return;
  job.artifacts[key] = value;
  job.updated_at = nowIso();
}

function isTerminal(job) {
  return job && TERMINAL_STATUSES.has(job.status);
}

module.exports = {
  STAGES,
  createJob,
  getJob,
  listJobs,
  startStage,
  finishStage,
  failStage,
  completeJob,
  setArtifact,
  isTerminal,
};
