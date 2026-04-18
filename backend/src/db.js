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