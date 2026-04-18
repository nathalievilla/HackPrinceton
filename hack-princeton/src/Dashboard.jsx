import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import Auth from './Auth'
import Papa from 'papaparse'

export default function Dashboard() {
  const [session, setSession] = useState(undefined)
  const [mode, setMode] = useState('medical') // 'medical' | 'statistician'
  const [csvData, setCsvData] = useState(null)
  const [fileName, setFileName] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null) // { summary, rCode, pvalues, plots }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  function handleLogout() {
    setSession(null)
  }

  function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    Papa.parse(file, {
      header: true,
      complete: ({ data }) => setCsvData(data)
    })
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
      setResult({ summary: 'Analysis failed. Please try again.', rCode: '', pvalues: '', confidenceIntervals: '', subgroup: '' })
    }

    setLoading(false)
  }

  if (session === undefined) return <p style={{ padding: '2rem' }}>Loading...</p>
  if (!session) return <Auth onAuth={(user) => setSession(user)} />

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
                style={{
                  width: 44, height: 24, borderRadius: 12, cursor: 'pointer', position: 'relative',
                  background: mode === 'statistician' ? '#185FA5' : '#555',
                  transition: 'background 0.2s'
                }}
              >
                <div style={{
                  position: 'absolute', top: 3, left: mode === 'statistician' ? 23 : 3,
                  width: 18, height: 18, borderRadius: '50%', background: 'white',
                  transition: 'left 0.2s'
                }} />
              </div>
              <span style={{ color: mode === 'statistician' ? '#185FA5' : 'inherit', fontWeight: mode === 'statistician' ? 500 : 400 }}>
                Statistician
              </span>
            </div>
            <button onClick={handleLogout} style={{ fontSize: 13, padding: '6px 14px' }}>
              Log out
            </button>
          </div>
        </div>
      </section>

      <div className="ticks"></div>

      {/* Three panel layout */}
      <section style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 0,
        borderTop: '1px solid var(--border)',
        minHeight: '60vh'
      }}>

        {/* Upload Panel */}
        <div style={{
          padding: '2.5rem 2rem',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 16
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.2px' }}>Upload</h2>
          <p style={{ fontSize: 13, opacity: 0.6, lineHeight: 1.6 }}>
            Upload a clinical trial CSV to begin analysis.
          </p>

          <label style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            border: '1px dashed var(--border)', borderRadius: 10,
            padding: '2rem 1.5rem', cursor: 'pointer', width: '100%',
            fontSize: 13, opacity: 0.8, transition: 'opacity 0.2s'
          }}>
            <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            {fileName ? `✓ ${fileName}` : 'Choose CSV file'}
            <input type="file" accept=".csv" onChange={handleUpload} style={{ display: 'none' }} />
          </label>

          {csvData && (
            <p style={{ fontSize: 12, opacity: 0.5 }}>{csvData.length} rows loaded</p>
          )}

          <button
            onClick={runAnalysis}
            disabled={!csvData || loading}
            style={{ fontSize: 13, padding: '10px 24px', width: '100%', justifyContent: 'center', marginTop: 'auto' }}
          >
            {loading ? 'Analyzing...' : 'Run Analysis'}
          </button>
        </div>

        {/* Charts / Stats Panel */}
        <div style={{
          padding: '2.5rem 2rem',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.2px' }}>
            {mode === 'statistician' ? 'Statistical Output' : 'Key Finding'}
          </h2>

          {!result && !loading && (
            <p style={{ fontSize: 13, opacity: 0.5 }}>Upload a CSV and run analysis to see results.</p>
          )}
          {loading && <p style={{ fontSize: 13, opacity: 0.6 }}>Running analysis...</p>}

          {result && mode === 'statistician' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 6 }}>P-values</p>
                <p style={{ fontSize: 13, lineHeight: 1.6 }}>{result.pvalues}</p>
              </div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 6 }}>Confidence Intervals</p>
                <p style={{ fontSize: 13, lineHeight: 1.6 }}>{result.confidenceIntervals}</p>
              </div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5, marginBottom: 6 }}>Generated R Code</p>
                <pre style={{
                  background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 12,
                  fontSize: 11, overflowX: 'auto', whiteSpace: 'pre-wrap',
                  maxHeight: 320, overflowY: 'auto', lineHeight: 1.6,
                  fontFamily: 'var(--font-mono, monospace)'
                }}>
                  {result.rCode}
                </pre>
              </div>
            </div>
          )}

          {result && mode === 'medical' && (
            <div style={{ fontSize: 13, lineHeight: 1.7, opacity: 0.85 }}>
              {result.subgroup}
            </div>
          )}
        </div>

        {/* AI Output Panel */}
        <div style={{
          padding: '2.5rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.2px' }}>AI Interpretation</h2>

          {!result && !loading && (
            <p style={{ fontSize: 13, opacity: 0.5 }}>AI interpretation will appear here.</p>
          )}
          {loading && <p style={{ fontSize: 13, opacity: 0.6 }}>Generating interpretation...</p>}

          {result && (
            <div style={{
              borderLeft: '2px solid #185FA5',
              paddingLeft: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}>
              <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>{result.summary}</p>
              {mode === 'statistician' && (
                <p style={{ fontSize: 11, opacity: 0.4, marginTop: 8 }}>
                  Switch to Medical Director mode for clean summary only.
                </p>
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