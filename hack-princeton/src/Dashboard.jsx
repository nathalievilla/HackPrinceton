import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import Auth from './Auth'
import Papa from 'papaparse'

const REQUIRED_COLUMNS = ['age', 'treatment_arm', 'outcome']

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

export default function Dashboard() {
  const [session, setSession] = useState(undefined)
  const [mode, setMode] = useState('medical')
  const [csvData, setCsvData] = useState(null)
  const [fileName, setFileName] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)
  const [result, setResult] = useState(null)
  const [csvError, setCsvError] = useState(null)
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

  // Cycle through loading steps while analyzing
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
    Papa.parse(file, {
      header: true,
      complete: ({ data }) => {
        const columns = Object.keys(data[0] || {}).map(c => c.toLowerCase())
        const missing = REQUIRED_COLUMNS.filter(r => !columns.includes(r))
        if (missing.length > 0) {
          setCsvError(`Missing required columns: ${missing.join(', ')}. Please check your CSV and re-upload.`)
          setCsvData(null)
          setFileName(null)
          return
        }
        setCsvData(data)
        setTrialInfo(t => ({ ...t, patients: data.length }))
      }
    })
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
    if (!csvData) return
    setLoading(true)
    setResult(null)

    const schema = Object.keys(csvData[0]).join(', ')
    const sample = csvData.slice(0, 5)

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: `You are an expert biostatistician analyzing clinical trial data.

CSV columns: ${schema}
Sample rows: ${JSON.stringify(sample, null, 2)}

Return a JSON object with exactly these fields:
{
  "summary": "2-3 sentence plain English summary for a medical director. No jargon.",
  "rCode": "Complete R code to analyze this dataset with XGBoost, SHAP, and Kaplan-Meier survival analysis",
  "pvalues": "Key p-values and what they mean, as a short string",
  "confidenceIntervals": "Key confidence intervals as a short string",
  "subgroup": "The most important subgroup finding in one sentence"
}

Return ONLY valid JSON, no markdown, no explanation.`
          }]
        })
      })

      const data = await response.json()
      const text = data.content.map(b => b.text || '').join('')
      const clean = text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      setResult(parsed)
    } catch (err) {
      setResult({
        summary: 'Analysis failed. Please try again.',
        rCode: '', pvalues: '', confidenceIntervals: '', subgroup: ''
      })
    }

    setLoading(false)
  }

  if (session === undefined) return <p style={{ padding: '2rem' }}>Loading...</p>
  if (!session) return <Auth onAuth={(user) => setSession(user)} />

  const labelStyle = { fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.4, marginBottom: 6 }

  return (
    <>
      {/* Top bar */}
      <section id="center" style={{ padding: '2rem 3rem' }}>
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ marginBottom: 4, fontSize: 32, letterSpacing: '-0.5px' }}>NAME TBD</h1>
            <p style={{ margin: 0, fontSize: 14, opacity: 0.6 }}>Clinical trial subgroup analysis</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ color: mode === 'medical' ? 'var(--accent)' : 'inherit', fontWeight: mode === 'medical' ? 500 : 400 }}>
                Medical Director
              </span>
              <div
                onClick={() => setMode(m => m === 'medical' ? 'statistician' : 'medical')}
                style={{ width: 44, height: 24, borderRadius: 12, cursor: 'pointer', position: 'relative', background: mode === 'statistician' ? '#185FA5' : '#555', transition: 'background 0.2s' }}
              >
                <div style={{ position: 'absolute', top: 3, left: mode === 'statistician' ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
              </div>
              <span style={{ color: mode === 'statistician' ? '#185FA5' : 'inherit', fontWeight: mode === 'statistician' ? 500 : 400 }}>
                Statistician
              </span>
            </div>
            <button onClick={handleLogout} style={{ fontSize: 13, padding: '6px 14px' }}>Log out</button>
          </div>
        </div>
      </section>

      {/* Trial context banner */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 0, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
        padding: '1rem 3rem', background: 'rgba(255,255,255,0.02)'
      }}>
        {[
          { label: 'Trial', value: trialInfo.name },
          { label: 'Indication', value: trialInfo.indication },
          { label: 'Status', value: trialInfo.status },
          { label: 'Sponsor', value: trialInfo.sponsor },
        ].map(({ label, value }) => (
          <div key={label} style={{ paddingRight: 24 }}>
            <p style={labelStyle}>{label}</p>
            <p style={{ fontSize: 13, lineHeight: 1.4 }}>{value}</p>
          </div>
        ))}
      </div>

      <div className="ticks"></div>

      {/* Three panel layout */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, borderTop: '1px solid var(--border)', minHeight: '60vh' }}>

        {/* Upload Panel */}
        <div style={{ padding: '2.5rem 2rem', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.2px' }}>Upload</h2>
          <p style={{ fontSize: 13, opacity: 0.6, lineHeight: 1.6 }}>
            Upload a clinical trial CSV to begin analysis.
          </p>

          <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, border: csvError ? '1px dashed #f87171' : '1px dashed var(--border)', borderRadius: 10, padding: '2rem 1.5rem', cursor: 'pointer', width: '100%', fontSize: 13, opacity: 0.8, transition: 'opacity 0.2s' }}>
            <svg width="28" height="28" fill="none" stroke={csvError ? '#f87171' : 'currentColor'} strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            {fileName ? `✓ ${fileName}` : 'Choose CSV file'}
            <input type="file" accept=".csv" onChange={handleUpload} style={{ display: 'none' }} />
          </label>

          {/* CSV error */}
          {csvError && (
            <div style={{ width: '100%', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '10px 14px', textAlign: 'left' }}>
              <p style={{ fontSize: 12, color: '#f87171', lineHeight: 1.6, margin: 0 }}>{csvError}</p>
              <p style={{ fontSize: 11, opacity: 0.6, marginTop: 6, color: '#f87171' }}>
                Required: {REQUIRED_COLUMNS.join(', ')}
              </p>
            </div>
          )}

          {csvData && !csvError && (
            <p style={{ fontSize: 12, opacity: 0.5 }}>{csvData.length} rows loaded</p>
          )}

          {/* Loading state */}
          {loading && (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2, background: '#185FA5',
                  width: `${((loadingStep + 1) / LOADING_STEPS.length) * 100}%`,
                  transition: 'width 1.6s ease'
                }} />
              </div>
              <p style={{ fontSize: 12, opacity: 0.5, textAlign: 'center' }}>{LOADING_STEPS[loadingStep]}</p>
            </div>
          )}

          <button
            onClick={runAnalysis}
            disabled={!csvData || loading || !!csvError}
            style={{ fontSize: 13, padding: '10px 24px', width: '100%', justifyContent: 'center', marginTop: 'auto' }}
          >
            {loading ? 'Analyzing...' : 'Run Analysis'}
          </button>
        </div>

        {/* Stats Panel */}
          <div style={{ padding: '2.5rem 2rem', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.2px' }}>
              {mode === 'statistician' ? 'Statistical Output' : 'Key Finding'}
            </h2>
            {result && mode === 'statistician' && result.rCode && (
              <button onClick={downloadRCode} style={{ fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download .R
              </button>
            )}
          </div>

          {!result && !loading && <p style={{ fontSize: 13, opacity: 0.5 }}>Upload a CSV and run analysis to see results.</p>}

          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[80, 60, 90].map((w, i) => (
                <div key={i} style={{ height: 12, borderRadius: 4, background: 'rgba(255,255,255,0.06)', width: `${w}%`, animation: 'pulse 1.5s ease infinite' }} />
              ))}
              <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.9} }`}</style>
            </div>
          )}

          {result && mode === 'statistician' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <p style={labelStyle}>P-values</p>
                <p style={{ fontSize: 13, lineHeight: 1.6 }}>{result.pvalues}</p>
              </div>
              <div>
                <p style={labelStyle}>Confidence Intervals</p>
                <p style={{ fontSize: 13, lineHeight: 1.6 }}>{result.confidenceIntervals}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <p style={{ ...labelStyle, marginBottom: 0 }}>Generated R Code</p>
              </div>
              <pre style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 12, fontSize: 11, overflowX: 'auto', whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto', lineHeight: 1.6, fontFamily: 'var(--font-mono, monospace)' }}>
                {result.rCode}
              </pre>
            </div>
          )}

          {result && mode === 'medical' && (
            <div style={{ fontSize: 13, lineHeight: 1.7, opacity: 0.85, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1 }}>{result.subgroup}</div>
          )}
        </div>

        {/* AI Output Panel */}
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
            <div style={{ borderLeft: '2px solid #185FA5', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>{result.summary}</p>
              {mode === 'statistician' && (
                <p style={{ fontSize: 11, opacity: 0.4, marginTop: 8 }}>Switch to Medical Director mode for clean summary only.</p>
              )}
            </div>
          )}
        </div>

      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}