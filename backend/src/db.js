<<<<<<< Updated upstream
console.log('[db] SUPABASE_URL:', process.env.SUPABASE_URL)
console.log('[db] SERVICE_KEY set:', !!process.env.SUPABASE_SERVICE_KEY)

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

async function upsertJob(job) {
  const { error } = await supabase
    .from('jobs')
    .upsert({
=======
/**
 * Supabase persistence layer.
 *
 * IMPORTANT (agent guardrail):
 *   - All Supabase access goes through this module. Routes and pipeline.js
 *     never import @supabase/supabase-js directly.
 *   - Every helper is tolerant of Supabase being unconfigured: if
 *     SUPABASE_URL or SUPABASE_SERVICE_KEY is missing, helpers no-op
 *     and log a warning. The demo still works without persistence.
 *   - Agent 1 output, Agent 1 R code, and Agent 2 output are persisted in
 *     SEPARATE columns (auditability requirement).
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

let _client = null;
function client() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

function isConfigured() {
  return !!client();
}

async function saveCsvUpload({ job_id, original_filename, row_count, columns }) {
  const c = client();
  if (!c) return { ok: false, skipped: true };
  const { error } = await c
    .from("csv_uploads")
    .insert({ job_id, original_filename, row_count, columns });
  if (error) {
    console.error("[db] saveCsvUpload error:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function upsertJob(job) {
  const c = client();
  if (!c) return { ok: false, skipped: true };
  const { error } = await c.from("jobs").upsert(
    {
>>>>>>> Stashed changes
      job_id: job.job_id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      created_at: job.created_at,
      updated_at: job.updated_at,
      completed_at: job.completed_at || null,
      uploaded_file: job.uploaded_file,
      stages: job.stages,
      artifacts: job.artifacts,
      error: job.error || null,
<<<<<<< Updated upstream
    }, { onConflict: 'job_id' })

  if (error) console.error('[db] upsertJob error:', error.message)
}

async function saveCsvUpload({ job_id, original_filename, row_count, columns }) {
  console.log('[db] saveCsvUpload called:', job_id, original_filename)  // ADD
  const { error } = await supabase
    .from('csv_uploads')
    .insert({ job_id, original_filename, row_count, columns })

  if (error) console.error('[db] saveCsvUpload error:', error.message)
  else console.log('[db] saved to csv_uploads ok')  // ADD
}

async function saveReport(job_id, report) {
  const { error } = await supabase
    .from('jobs')
    .update({
      report,
      summary: report.headline,
      updated_at: new Date().toISOString()
    })
    .eq('job_id', job_id)

  if (error) console.error('[db] saveReport error:', error.message)
}

async function getJobFromDb(job_id) {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('job_id', job_id)
    .single()

  if (error) return null
  return data
}

async function updateCsvUploadSummary(job_id, summary) {
  const { error } = await supabase
    .from('csv_uploads')
    .update({ summary })
    .eq('job_id', job_id)

  if (error) console.error('[db] updateCsvUploadSummary error:', error.message)
}

module.exports = { upsertJob, saveCsvUpload, saveReport, getJobFromDb, updateCsvUploadSummary }
=======
    },
    { onConflict: "job_id" }
  );
  if (error) console.error("[db] upsertJob error:", error.message);
  return { ok: !error, error: error?.message };
}

async function saveAgent1Output(job_id, { r_code, output, execution, provider, model }) {
  const c = client();
  if (!c) return { ok: false, skipped: true };
  const { error } = await c
    .from("jobs")
    .update({
      agent1_r_code: r_code || null,
      agent1_output: output || null,
      agent1_execution: execution || null,
      agent1_provider: provider || null,
      agent1_model: model || null,
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", job_id);
  if (error) console.error("[db] saveAgent1Output error:", error.message);
  return { ok: !error, error: error?.message };
}

async function saveAgent2Output(job_id, { clinically_reasonable, flags, summary, provider, model }) {
  const c = client();
  if (!c) return { ok: false, skipped: true };
  const { error } = await c
    .from("jobs")
    .update({
      agent2_qc: { clinically_reasonable, flags },
      agent2_summary: summary || null,
      agent2_provider: provider || null,
      agent2_model: model || null,
      summary: summary || null,
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", job_id);
  if (error) console.error("[db] saveAgent2Output error:", error.message);
  return { ok: !error, error: error?.message };
}

async function saveReport(job_id, report) {
  const c = client();
  if (!c) return { ok: false, skipped: true };
  const { error } = await c
    .from("jobs")
    .update({
      report,
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", job_id);
  if (error) console.error("[db] saveReport error:", error.message);
  return { ok: !error, error: error?.message };
}

async function getRecentAnalyses({ limit = 25 } = {}) {
  const c = client();
  if (!c) return { ok: false, skipped: true, rows: [] };
  const { data, error } = await c
    .from("jobs")
    .select("job_id, status, created_at, completed_at, summary, uploaded_file")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[db] getRecentAnalyses error:", error.message);
    return { ok: false, error: error.message, rows: [] };
  }
  return { ok: true, rows: data || [] };
}

async function getAnalysisById(job_id) {
  const c = client();
  if (!c) return { ok: false, skipped: true, row: null };
  const { data, error } = await c
    .from("jobs")
    .select("*")
    .eq("job_id", job_id)
    .single();
  if (error) return { ok: false, error: error.message, row: null };
  return { ok: true, row: data };
}

module.exports = {
  isConfigured,
  saveCsvUpload,
  upsertJob,
  saveAgent1Output,
  saveAgent2Output,
  saveReport,
  getRecentAnalyses,
  getAnalysisById,
};
>>>>>>> Stashed changes
