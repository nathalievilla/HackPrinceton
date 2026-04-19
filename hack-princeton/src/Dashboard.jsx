import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import Auth from './Auth'
import Papa from 'papaparse'

const TREATMENT_ALIASES = ['trt', 'treatment_group', 'treatment', 'arm', 'treatment_arm']
const OUTCOME_ALIASES = ['label', 'outcome', 'response', 'event', 'status', 'adverse_events', 'dropout']
const AGE_ALIASES = ['age']

function detectColumns(columns) {
  const lower = columns.map(c => c.toLowerCase())
  const treatment = TREATMENT_ALIASES.find(a => lower.includes(a))
  const outcome = OUTCOME_ALIASES.find(a => lower.includes(a))
  const age = AGE_ALIASES.find(a => lower.includes(a))
  return {
    treatment, outcome, age,
    missing: [!age && 'age', !treatment && 'treatment column', !outcome && 'outcome column'].filter(Boolean)
  }
}

const LOADING_STEPS = [
  'Reading your dataset...',
  'Identifying column types and distributions...',
  'Writing R analysis code...',
  'Running XGBoost model...',
  'Computing SHAP values...',
  'Fitting Kaplan-Meier curves...',
  'Running manager check on results...',
  'Generating plain-English summary...',
]

function Collapsible({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', cursor: 'pointer', background: 'rgba(255,255,255,0.02)' }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>
        <svg width="20" height="20" fill="none" stroke="#185FA5" strokeWidth="2" viewBox="0 0 24 24"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {open && (
        <div style={{ padding: '16px 18px', borderTop: '1px solid var(--border)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

function StatisticalSummary({ result }) {
  if (!result) return <p style={{ fontSize: 13, opacity: 0.5 }}>Run analysis to see statistical output.</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
          <p style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.4, margin: '0 0 6px' }}>P-value</p>
          <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>{result.pvalues || '—'}</p>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
          <p style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.4, margin: '0 0 6px' }}>Confidence interval</p>
          <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>{result.confidenceIntervals || '—'}</p>
        </div>
      </div>
    </div>
  )
}

function DemographicsTable({ csvData, detectedCols }) {
  if (!csvData || csvData.length === 0) return <p style={{ fontSize: 13, opacity: 0.5 }}>No data loaded.</p>
  const trtCol = Object.keys(csvData[0]).find(k => TREATMENT_ALIASES.includes(k.toLowerCase())) || 'trt'
  const arms = [...new Set(csvData.map(r => r[trtCol]))]
  const allCols = Object.keys(csvData[0] || {})
  const numericCols = allCols.filter(col => {
    const vals = csvData.slice(0, 20).map(r => parseFloat(r[col]))
    return vals.filter(v => !isNaN(v)).length > 15
  }).filter(c => !['subject_id', 'site_id', 'enrollment_date'].includes(c.toLowerCase()))

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)', opacity: 0.5, fontWeight: 500 }}>Characteristic</th>
            {arms.map(arm => (
              <th key={arm} style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '1px solid var(--border)', opacity: 0.5, fontWeight: 500 }}>
                {arm} (n={csvData.filter(r => r[trtCol] === arm).length})
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {numericCols.map((col, i) => (
            <tr key={col} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{col}</td>
              {arms.map(arm => {
                const vals = csvData.filter(r => r[trtCol] === arm).map(r => parseFloat(r[col])).filter(v => !isNaN(v))
                const mean = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—'
                const sd = vals.length ? Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - parseFloat(mean), 2), 0) / vals.length).toFixed(1) : '—'
                return (
                  <td key={arm} style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    {mean} ± {sd}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EfficacyTable({ result }) {
  if (!result) return <p style={{ fontSize: 13, opacity: 0.5 }}>Run analysis to see efficacy data.</p>
  const rows = [
    { label: 'Primary endpoint p-value', value: result.pvalues || '—' },
    { label: 'Confidence intervals', value: result.confidenceIntervals || '—' },
    { label: 'Key subgroup finding', value: result.subgroup || '—' },
  ]
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
            <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: 0.6, width: '40%' }}>{row.label}</td>
            <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', lineHeight: 1.5 }}>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function KMFigure({ result }) {
  if (!result) return null
  const W = 900, H = 340, PAD = { top: 24, right: 32, bottom: 48, left: 52 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom
  const timePoints = [0, 4, 8, 12, 16, 20, 24]
  const curves = {
    'Overall': { points: [1.0, 0.95, 0.9, 0.82, 0.78, 0.74, 0.7], color: '#185FA5' },
    'High responders': { points: [1.0, 0.98, 0.96, 0.93, 0.9, 0.88, 0.85], color: '#1D9E75' },
    'Low responders': { points: [1.0, 0.93, 0.85, 0.76, 0.68, 0.6, 0.55], color: '#D85A30' },
  }
  const xScale = t => PAD.left + (t / 24) * chartW
  const yScale = v => PAD.top + (1 - v) * chartH

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" style={{ minWidth: 600, display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1.0].map(v => (
          <g key={v}>
            <line x1={PAD.left} y1={yScale(v)} x2={PAD.left + chartW} y2={yScale(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={PAD.left - 10} y={yScale(v) + 4} fontSize="11" fill="rgba(255,255,255,0.4)" textAnchor="end">{Math.round(v * 100)}%</text>
          </g>
        ))}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + chartH} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
        <line x1={PAD.left} y1={PAD.top + chartH} x2={PAD.left + chartW} y2={PAD.top + chartH} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
        {timePoints.map(t => (
          <g key={t}>
            <line x1={xScale(t)} y1={PAD.top + chartH} x2={xScale(t)} y2={PAD.top + chartH + 6} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
            <text x={xScale(t)} y={PAD.top + chartH + 20} fontSize="11" fill="rgba(255,255,255,0.4)" textAnchor="middle">{t} mo</text>
          </g>
        ))}
        <text x={PAD.left + chartW / 2} y={H - 4} fontSize="11" fill="rgba(255,255,255,0.3)" textAnchor="middle">Time (months)</text>
        <text x={16} y={PAD.top + chartH / 2} fontSize="11" fill="rgba(255,255,255,0.3)" textAnchor="middle" transform={`rotate(-90, 16, ${PAD.top + chartH / 2})`}>Survival probability</text>
        {Object.entries(curves).map(([name, { points, color }]) => {
          const pts = points.map((v, i) => `${xScale(timePoints[i])},${yScale(v)}`).join(' ')
          return (
            <g key={name}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={xScale(timePoints[timePoints.length - 1])} cy={yScale(points[points.length - 1])} r="4" fill={color} />
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 12, paddingLeft: PAD.left }}>
        {Object.entries(curves).map(([name, { color }]) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.8 }}>
            <div style={{ width: 20, height: 3, borderRadius: 2, background: color }} />
            {name}
          </div>
        ))}
      </div>
    </div>
  )
}

function PastAnalyses() {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('http://localhost:3000/results')
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        return response.json()
      })
      .then(data => {
        const mappedRows = (data.rows || []).map(row => ({
          id: row.job_id,
          original_filename: row.uploaded_file?.name || 'Unknown file',
          row_count: row.uploaded_file?.size || '—',
          columns: row.uploaded_file?.columns || [],
          summary: row.summary || '—',
          uploaded_at: row.created_at
        }))
        setHistory(mappedRows)
        setLoading(false)
      })
      .catch(err => {
        console.error('PastAnalyses fetch error:', err)
        setError(err.message)
        setLoading(false)
      })
  }, [])

  if (loading) return <p style={{ fontSize: 13, opacity: 0.5, padding: '1rem' }}>Loading history...</p>
  if (error) return <p style={{ fontSize: 13, color: '#f87171', padding: '1rem' }}>Error: {error}</p>
  if (history.length === 0) return <p style={{ fontSize: 13, opacity: 0.5, padding: '1rem' }}>No past analyses yet.</p>

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['File', 'Rows', 'Columns', 'Summary', 'Date'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)', opacity: 0.5, fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((row, i) => (
            <tr key={row.id} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{row.original_filename}</td>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{row.row_count}</td>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {Array.isArray(row.columns) ? row.columns.join(', ') : '—'}
              </td>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.7 }}>
                {row.summary || '—'}
              </td>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: 0.5, whiteSpace: 'nowrap' }}>
                {new Date(row.uploaded_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Dashboard() {
  const [session, setSession] = useState(undefined)
  const [mode, setMode] = useState('medical')
  const [csvData, setCsvData] = useState(null)
  const [fileName, setFileName] = useState(null)
  const [rawFile, setRawFile] = useState(null)
  const [detectedCols, setDetectedCols] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)
  const [result, setResult] = useState(null)
  const [csvError, setCsvError] = useState(null)
  const [activeTab, setActiveTab] = useState('analysis')
  const [trialInfo, setTrialInfo] = useState({
    name: 'Dupilumab Pediatric Asthma',
    indication: 'Moderate-to-severe asthma in children aged 2–11',
    status: 'Phase 3 — Active',
    sponsor: 'Regeneron / Sanofi',
    patients: null,
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setSession(session ?? null))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!loading) { setLoadingStep(0); return }
    const interval = setInterval(() => {
      setLoadingStep(s => (s + 1) % LOADING_STEPS.length)
    }, 1800)
    return () => clearInterval(interval)
  }, [loading])

  function handleLogout() { setSession(null) }

  function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setCsvError(null)
    setResult(null)
    setFileName(file.name)
    setRawFile(file)
    Papa.parse(file, {
      header: true,
      complete: ({ data }) => {
        const columns = Object.keys(data[0] || {})
        const detected = detectColumns(columns)
        if (detected.missing.length > 0) {
          setCsvError(`Could not find required columns: ${detected.missing.join(', ')}. Found: ${columns.join(', ')}`)
          setCsvData(null)
          setFileName(null)
          setRawFile(null)
          return
        }
        setCsvData(data)
        setDetectedCols(detected)
        setTrialInfo(t => ({ ...t, patients: data.length }))
      }
    })
  }

  function resetUpload() {
    setCsvData(null)
    setFileName(null)
    setRawFile(null)
    setCsvError(null)
    setResult(null)
    setDetectedCols(null)
  }

  function downloadRCode() {
    if (!result?.rCode) return
    const blob = new Blob([result.rCode], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'nametbd_analysis.R'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function runAnalysis() {
    if (!csvData || !rawFile) return
    setLoading(true)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', rawFile)
      const uploadRes = await fetch('http://localhost:3000/upload', {
        method: 'POST',
        body: formData,
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!uploadRes.ok) {
        const errorData = await uploadRes.json()
        if (errorData.error === 'csv_analysis_failed') {
          setResult({ summary: `CSV analysis failed: ${errorData.details?.map(d => d.message).join('; ') || 'Unknown error'}`, rCode: '', pvalues: '', confidenceIntervals: '', subgroup: '' })
        } else {
          setResult({ summary: `Upload failed: ${errorData.error || 'Unknown error'}. ${errorData.details ? JSON.stringify(errorData.details) : ''}`, rCode: '', pvalues: '', confidenceIntervals: '', subgroup: '' })
        }
        setLoading(false)
        return
      }
      const { job_id } = await uploadRes.json()
      let job = null
      while (true) {
        await new Promise(r => setTimeout(r, 1500))
        const pollRes = await fetch(`http://localhost:3000/jobs/${job_id}`)
        job = await pollRes.json()
        if (job.status === 'completed' || job.status === 'failed') break
      }
      if (job.status === 'failed') {
        setResult({ summary: `Analysis failed: ${job.error?.message}`, rCode: '', pvalues: '', confidenceIntervals: '', subgroup: '' })
        setLoading(false)
        return
      }
      const reportRes = await fetch(`http://localhost:3000/report/${job_id}`)
      const report = await reportRes.json()
      setResult({
        summary: report.headline,
        rCode: report.results?.rCode || '',
        pvalues: report.results?.pvalues || '',
        confidenceIntervals: report.results?.confidenceIntervals || '',
        subgroup: report.results?.subgroup || report.headline
      })
    } catch (err) {
      setResult({ summary: 'Analysis failed. Please try again.', rCode: '', pvalues: '', confidenceIntervals: '', subgroup: '' })
    }
    setLoading(false)
  }

  if (session === undefined) return <p style={{ padding: '2rem' }}>Loading...</p>
  if (!session) return <Auth onAuth={(user) => setSession(user)} />

  const labelStyle = { fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.4, marginBottom: 6 }
  const tabStyle = (t) => ({
    fontSize: 13, padding: '8px 20px', cursor: 'pointer',
    color: activeTab === t ? '#185FA5' : 'inherit',
    opacity: activeTab === t ? 1 : 0.5,
    background: 'none', border: 'none',
    borderBottom: activeTab === t ? '2px solid #185FA5' : '2px solid transparent',
    fontWeight: activeTab === t ? 500 : 400
  })

  return (
    <>
      <section id="center" style={{ padding: '2rem 3rem' }}>
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ marginBottom: 4, fontSize: 32, letterSpacing: '-0.5px' }}>NAME TBD</h1>
            <p style={{ margin: 0, fontSize: 14, opacity: 0.6 }}>Clinical trial subgroup analysis</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ color: mode === 'medical' ? 'var(--accent)' : 'inherit', fontWeight: mode === 'medical' ? 500 : 400 }}>Medical Director</span>
              <div onClick={() => setMode(m => m === 'medical' ? 'statistician' : 'medical')}
                style={{ width: 44, height: 24, borderRadius: 12, cursor: 'pointer', position: 'relative', background: mode === 'statistician' ? '#185FA5' : '#555', transition: 'background 0.2s' }}>
                <div style={{ position: 'absolute', top: 3, left: mode === 'statistician' ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
              </div>
              <span style={{ color: mode === 'statistician' ? '#185FA5' : 'inherit', fontWeight: mode === 'statistician' ? 500 : 400 }}>Statistician</span>
            </div>
            <button onClick={handleLogout} style={{ fontSize: 13, padding: '6px 14px' }}>Log out</button>
          </div>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '1rem 3rem', background: 'rgba(255,255,255,0.02)' }}>
        {[{ label: 'Trial', value: trialInfo.name }, { label: 'Indication', value: trialInfo.indication }, { label: 'Status', value: trialInfo.status }, { label: 'Sponsor', value: trialInfo.sponsor }].map(({ label, value }) => (
          <div key={label} style={{ paddingRight: 24 }}>
            <p style={labelStyle}>{label}</p>
            <p style={{ fontSize: 13, lineHeight: 1.4 }}>{value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', padding: '0 3rem', gap: 4 }}>
        <button style={tabStyle('analysis')} onClick={() => setActiveTab('analysis')}>Analysis</button>
        <button style={tabStyle('history')} onClick={() => setActiveTab('history')}>Past Analyses</button>
      </div>

      <div className="ticks"></div>

      {activeTab === 'history' && (
        <div style={{ padding: '2rem 3rem' }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 20 }}>Past Analyses</h2>
          <PastAnalyses />
        </div>
      )}

      {activeTab === 'analysis' && (
        <>
          {/* Three column upload / key finding / AI interpretation row */}
          <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, borderTop: '1px solid var(--border)', minHeight: '40vh' }}>

            {/* Upload Panel */}
            <div style={{ padding: '2.5rem 2rem', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.2px' }}>Upload</h2>
              <p style={{ fontSize: 13, opacity: 0.6, lineHeight: 1.6 }}>Upload a clinical trial CSV to begin analysis.</p>
              <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, border: csvError ? '1px dashed #f87171' : '1px dashed var(--border)', borderRadius: 10, padding: '2rem 1.5rem', cursor: 'pointer', width: '100%', fontSize: 13, opacity: 0.8 }}>
                <svg width="28" height="28" fill="none" stroke={csvError ? '#f87171' : 'currentColor'} strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                {fileName ? `✓ ${fileName}` : 'Choose CSV file'}
                <input type="file" accept=".csv" onChange={handleUpload} style={{ display: 'none' }} />
              </label>
              {csvError && (
                <div style={{ width: '100%', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '10px 14px', textAlign: 'left' }}>
                  <p style={{ fontSize: 12, color: '#f87171', lineHeight: 1.6, margin: 0 }}>{csvError}</p>
                  <p style={{ fontSize: 11, opacity: 0.6, marginTop: 6, color: '#f87171' }}>
                    Accepted — treatment: {TREATMENT_ALIASES.join(', ')} / outcome: {OUTCOME_ALIASES.join(', ')}
                  </p>
                </div>
              )}
              {csvData && !csvError && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%' }}>
                  <p style={{ fontSize: 12, opacity: 0.5 }}>{csvData.length} rows loaded</p>
                  <button onClick={resetUpload} style={{ fontSize: 12, padding: '5px 14px', opacity: 0.6, width: '100%' }}>Upload a different file</button>
                </div>
              )}
              {loading && (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 2, background: '#185FA5', width: `${((loadingStep + 1) / LOADING_STEPS.length) * 100}%`, transition: 'width 1.6s ease' }} />
                  </div>
                  <p style={{ fontSize: 12, opacity: 0.5, textAlign: 'center' }}>{LOADING_STEPS[loadingStep]}</p>
                </div>
              )}
              <button onClick={runAnalysis} disabled={!csvData || loading || !!csvError}
                style={{ fontSize: 13, padding: '10px 24px', width: '100%', justifyContent: 'center', marginTop: 'auto' }}>
                {loading ? 'Analyzing...' : 'Run Analysis'}
              </button>
            </div>

            {/* Statistical Summary Panel — p-value and CI always visible, key finding below */}
            <div style={{ padding: '2.5rem 2rem', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.2px' }}>
                {mode === 'statistician' ? 'Statistical Summary' : 'Key Finding'}
              </h2>
              {!result && !loading && <p style={{ fontSize: 13, opacity: 0.5 }}>Upload a CSV and run analysis to see results.</p>}
              {loading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                  {[80, 60, 90].map((w, i) => (
                    <div key={i} style={{ height: 12, borderRadius: 4, background: 'rgba(255,255,255,0.06)', width: `${w}%`, animation: 'pulse 1.5s ease infinite' }} />
                  ))}
                  <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.9} }`}</style>
                </div>
              )}
              {result && mode === 'statistician' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                      <p style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.4, margin: '0 0 6px' }}>P-value</p>
                      <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>{result.pvalues || '—'}</p>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                      <p style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.4, margin: '0 0 6px' }}>95% CI</p>
                      <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>{result.confidenceIntervals || '—'}</p>
                    </div>
                  </div>
                  <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 12, marginTop: 4 }}>
                    <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0, opacity: 0.8 }}>{result.subgroup}</p>
                  </div>
                </div>
              )}
              {result && mode === 'medical' && (
                <div style={{ fontSize: 13, lineHeight: 1.7, opacity: 0.85, flex: 1, display: 'flex', alignItems: 'center' }}>
                  <p style={{ margin: 0 }}>{result.subgroup}</p>
                </div>
              )}
            </div>

            {/* AI Interpretation Panel */}
            <div style={{ padding: '2.5rem 2rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.2px' }}>AI Interpretation</h2>
              {!result && !loading && <p style={{ fontSize: 13, opacity: 0.5 }}>AI interpretation will appear here.</p>}
              {loading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[95, 70, 85].map((w, i) => (
                    <div key={i} style={{ height: 12, borderRadius: 4, background: 'rgba(255,255,255,0.06)', width: `${w}%`, animation: 'pulse 1.5s ease infinite', animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
              )}
              {result && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ borderLeft: '2px solid #185FA5', paddingLeft: 16 }}>
                    <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>{result.summary}</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Full-width results section — only shown after analysis, only in statistician mode */}
          {result && mode === 'statistician' && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '2rem 3rem', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Header row with download button */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Statistical Output</h2>
                {result.rCode && (
                  <button onClick={downloadRCode} style={{ fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Download .R
                  </button>
                )}
              </div>

              {/* 1. Survival Curves — always first */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px' }}>
                <p style={{ fontSize: 14, fontWeight: 500, margin: '0 0 16px' }}>Kaplan–Meier Survival Curves</p>
                <KMFigure result={result} />
              </div>

              {/* 2. Efficacy Table — collapsible, open by default */}
              <Collapsible title="Efficacy Table" defaultOpen>
                <EfficacyTable result={result} />
              </Collapsible>

              {/* 3. Demographics Table — collapsible, closed by default */}
              <Collapsible title="Demographics Table" defaultOpen={false}>
                <DemographicsTable csvData={csvData} detectedCols={detectedCols} />
              </Collapsible>

              {/* 4. Generated R Code — collapsible, closed by default */}
              <Collapsible title="Generated R Code" defaultOpen={false}>
                <pre style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 12, fontSize: 11, overflowX: 'auto', whiteSpace: 'pre-wrap', maxHeight: 280, overflowY: 'auto', lineHeight: 1.6, fontFamily: 'monospace', margin: 0 }}>
                  {result.rCode || '—'}
                </pre>
              </Collapsible>

            </div>
          )}

          {/* KM curves in medical director mode — kept below the three columns */}
          {result && mode === 'medical' && (
            <div style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '1.25rem 3rem', background: 'rgba(255,255,255,0.01)' }}>
              <Collapsible title="Kaplan–Meier Survival Curves" defaultOpen>
                <KMFigure result={result} />
              </Collapsible>
            </div>
          )}
        </>
      )}

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}