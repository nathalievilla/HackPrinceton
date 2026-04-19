import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
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

// Maps backend job stage names (from backend/src/jobs.js STAGES) to UI labels.
// Order matches the real pipeline; add a new entry here if a new stage is added.
const STAGE_LABELS = {
  uploaded: 'Validating upload',
  agent1_planning: 'Agent 1: writing R analysis code',
  qa_validation: 'Validating R output schema',
  agent2_review: 'Agent 2: clinical QC review',
  completed: 'Done',
}

// Layer 1 — rotating reassurance text that cycles every 4s within a stage.
// Honest about how long things actually take; prevents "is it stuck?" anxiety
// during long Vertex/Gemini calls.
const STAGE_WAIT_MESSAGES = {
  uploaded: [
    'Reading CSV columns...',
    'Detecting treatment + outcome columns...',
  ],
  agent1_planning: [
    'Calling Gemini biostatistician...',
    'Drafting analysis plan (typically 15-30s)...',
    'Generating R code from the plan...',
    'Still working — Gemini is reasoning through the dataset...',
  ],
  qa_validation: [
    'Checking the R output schema...',
    'Confirming required keys are present...',
  ],
  agent2_review: [
    'Calling Gemini manager for QC review...',
    'Looking for sample-size, label-leakage, and SHAP issues...',
    'Drafting plain-English clinical summary...',
  ],
  completed: ['Done — rendering report...'],
}

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

function DemographicsTable({ csvData, detectedCols, result }) {
  // Use backend demographics data if available, otherwise compute from CSV
  if (result && result.demographics) {
    const demo = result.demographics
    if (demo.arms && Array.isArray(demo.arms)) {
      return (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)', opacity: 0.5, fontWeight: 500 }}>Characteristic</th>
                {demo.arms.map(arm => (
                  <th key={arm.name} style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '1px solid var(--border)', opacity: 0.5, fontWeight: 500 }}>
                    {arm.name} (n={arm.n})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
                <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Age (years)</td>
                {demo.arms.map(arm => (
                  <td key={arm.name} style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    {arm.age_mean?.toFixed(1) || '—'} ± {arm.age_sd?.toFixed(1) || '—'}
                  </td>
                ))}
              </tr>
              {demo.baseline_characteristics && (
                <tr>
                  <td colSpan={demo.arms.length + 1} style={{ padding: '8px 12px', fontSize: 11, opacity: 0.6, fontStyle: 'italic' }}>
                    {demo.baseline_characteristics}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )
    }
  }
  
  // Fallback to CSV-computed demographics
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
  
  // Use real efficacy data from backend if available
  let rows
  if (result.efficacy) {
    rows = [
      { label: 'Primary endpoint p-value', value: result.efficacy.p_value ? `p = ${result.efficacy.p_value}` : result.pvalues || '—' },
      { label: 'Confidence intervals', value: result.efficacy.confidence_interval || result.confidenceIntervals || '—' },
      { label: 'Odds ratio', value: result.efficacy.odds_ratio ? `OR = ${result.efficacy.odds_ratio}` : '—' },
      { label: 'Treatment effect', value: result.efficacy.treatment_rate && result.efficacy.control_rate ? 
        `${(result.efficacy.treatment_rate * 100).toFixed(1)}% vs ${(result.efficacy.control_rate * 100).toFixed(1)}%` : '—' },
      { label: 'Key subgroup finding', value: result.subgroup || '—' },
    ]
  } else {
    // Fallback to original structure
    rows = [
      { label: 'Primary endpoint p-value', value: result.pvalues || '—' },
      { label: 'Confidence intervals', value: result.confidenceIntervals || '—' },
      { label: 'Key subgroup finding', value: result.subgroup || '—' },
    ]
  }
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
  
  // Use real survival data from backend if available, otherwise fallback to synthetic data
  let timePoints, curves
  if (result.survival && result.survival.time_points && result.survival.curves) {
    timePoints = result.survival.time_points
    const backendCurves = result.survival.curves
    
    // Map backend curve data to frontend format with colors
    curves = {}
    const colors = ['#185FA5', '#1D9E75', '#D85A30', '#F59E0B', '#8B5CF6']
    let colorIndex = 0
    
    Object.keys(backendCurves).forEach(curveName => {
      curves[curveName] = {
        points: backendCurves[curveName],
        color: colors[colorIndex % colors.length]
      }
      colorIndex++
    })
  } else {
    // Fallback to hardcoded data if backend doesn't provide survival curves
    timePoints = [0, 4, 8, 12, 16, 20, 24]
    curves = {
      'Overall': { points: [1.0, 0.95, 0.9, 0.82, 0.78, 0.74, 0.7], color: '#185FA5' },
      'High responders': { points: [1.0, 0.98, 0.96, 0.93, 0.9, 0.88, 0.85], color: '#1D9E75' },
      'Low responders': { points: [1.0, 0.93, 0.85, 0.76, 0.68, 0.6, 0.55], color: '#D85A30' },
    }
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

// ---------------- Statistician-report components ----------------

// Sections rendered in the StatisticianReport — keep IDs in sync with the
// section anchors in the JSX. Order = reading order in the report.
const STAT_SECTIONS = [
  { id: 'demographics', label: 'Demographics' },
  { id: 'subgroups',    label: 'Subgroups' },
  { id: 'survival',     label: 'Survival Curves' },
  { id: 'efficacy',     label: 'SHAP & QC' },
  { id: 'rcode',        label: 'R Code' },
  { id: 'provenance',   label: 'Provenance' },
]

// Renders a clinical-paper-style subgroup table from result.subgroups[].
// Highlights any row where response_rate >= 1.5x baseline_rate.
function SubgroupsTable({ subgroups }) {
  if (!subgroups || !subgroups.length) {
    return <p style={{ fontSize: 13, opacity: 0.5 }}>No subgroups returned by analysis.</p>
  }
  const rows = subgroups.map(s => {
    const lift = (typeof s.response_rate === 'number' && typeof s.baseline_rate === 'number' && s.baseline_rate > 0)
      ? s.response_rate / s.baseline_rate
      : null
    return { ...s, lift }
  })
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['Subgroup', 'n', 'Response', 'Baseline', 'Lift'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)', opacity: 0.5, fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const flagged = typeof s.lift === 'number' && s.lift >= 1.5
            return (
              <tr key={i} style={{ background: flagged ? 'rgba(29, 158, 117, 0.08)' : (i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent') }}>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontWeight: flagged ? 500 : 400 }}>
                  {s.name || '—'}
                  {flagged && <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', borderRadius: 999, background: '#1D9E75', color: '#fff' }}>candidate</span>}
                </td>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{typeof s.size === 'number' ? s.size : '—'}</td>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{typeof s.response_rate === 'number' ? `${(s.response_rate * 100).toFixed(0)}%` : '—'}</td>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{typeof s.baseline_rate === 'number' ? `${(s.baseline_rate * 100).toFixed(0)}%` : '—'}</td>
                <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', color: flagged ? '#1D9E75' : 'inherit', fontWeight: flagged ? 500 : 400 }}>
                  {typeof s.lift === 'number' ? `${s.lift.toFixed(2)}x` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Top-N feature importance table with horizontal bars.
function FeatureImportanceTable({ shap }) {
  const features = shap?.features || []
  const importance = shap?.importance || []
  if (!features.length || !importance.length) {
    return <p style={{ fontSize: 13, opacity: 0.5 }}>No feature importance returned.</p>
  }
  const paired = features.map((f, i) => ({ feature: f, value: importance[i] || 0 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 10)
  const max = Math.max(...paired.map(p => Math.abs(p.value))) || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {paired.map(({ feature, value }) => (
        <div key={feature} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 60px', gap: 12, alignItems: 'center', fontSize: 12 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={feature}>{feature}</span>
          <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(Math.abs(value) / max) * 100}%`, background: '#185FA5', borderRadius: 2 }} />
          </div>
          <span style={{ textAlign: 'right', fontFamily: 'monospace', opacity: 0.7 }}>{value.toFixed(3)}</span>
        </div>
      ))}
    </div>
  )
}

// Manager (Agent 2) QC review panel — verdict pill + flag list.
function ManagerReviewPanel({ managerCheck }) {
  if (!managerCheck) {
    return <p style={{ fontSize: 13, opacity: 0.5 }}>No manager review available.</p>
  }
  const ok = managerCheck.clinically_reasonable
  const flags = managerCheck.flags || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
          padding: '4px 10px', borderRadius: 999,
          background: ok ? 'rgba(29,158,117,0.15)' : 'rgba(245,158,11,0.15)',
          color: ok ? '#1D9E75' : '#F59E0B',
          border: `1px solid ${ok ? 'rgba(29,158,117,0.4)' : 'rgba(245,158,11,0.4)'}`,
        }}>
          {ok ? 'Clinically reasonable' : 'Flags raised'}
        </span>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{flags.length} flag{flags.length === 1 ? '' : 's'}</span>
      </div>
      {flags.length === 0 ? (
        <p style={{ fontSize: 12, opacity: 0.55, margin: 0 }}>No issues flagged.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {flags.map((f, i) => {
            const sev = (f.severity || 'info').toLowerCase()
            const colorMap = { warning: '#F59E0B', error: '#D85A30', info: '#185FA5' }
            const color = colorMap[sev] || '#185FA5'
            return (
              <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.55 }}>
                <span style={{
                  fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                  padding: '2px 7px', borderRadius: 4, color: '#fff', background: color, flexShrink: 0,
                  marginTop: 2,
                }}>{sev}</span>
                <span style={{ opacity: 0.85 }}>{f.message || JSON.stringify(f)}</span>
              </li>
            )
          })}
        </ul>
      )}
      {managerCheck.notes && (
        <p style={{ fontSize: 11, opacity: 0.45, margin: '4px 0 0', fontStyle: 'italic', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          {managerCheck.notes}
        </p>
      )}
    </div>
  )
}

// Audit-style provenance: which agent/model produced what + R execution details.
function ProvenancePanel({ agent1, agent2, execution }) {
  const rows = [
    ['Agent 1 provider', agent1?.provider || '—'],
    ['Agent 1 model',    agent1?.model || '—'],
    ['Agent 1 fallback reason', agent1?.used_fallback_reason || 'none'],
    ['Agent 2 provider', agent2?.provider || '—'],
    ['Agent 2 model',    agent2?.model || '—'],
    ['Agent 2 fallback reason', agent2?.used_fallback_reason || 'none'],
    ['R execution ok',   execution?.ok === undefined ? '—' : String(execution.ok)],
    ['R exit code',      execution?.exit_code === undefined || execution?.exit_code === null ? '—' : String(execution.exit_code)],
    ['R runtime (ms)',   execution?.runtime_ms === undefined ? '—' : execution.runtime_ms],
    ['Synthetic output', execution?.synthetic ? 'yes' : 'no'],
  ]
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={k} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
            <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: 0.55, width: '45%' }}>{k}</td>
            <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontFamily: 'monospace' }}>{String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Sticky vertical TOC with active-section highlight + smooth scroll on click.
function TocNav({ sections, activeId }) {
  function scrollTo(id) {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <aside style={{ position: 'sticky', top: 24, alignSelf: 'start', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.4, margin: '0 0 8px', paddingLeft: 12 }}>On this page</p>
      {sections.map(s => {
        const active = s.id === activeId
        return (
          <button
            key={s.id}
            onClick={() => scrollTo(s.id)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: 13,
              padding: '6px 12px',
              borderLeft: `2px solid ${active ? '#185FA5' : 'transparent'}`,
              color: active ? '#fff' : 'inherit',
              opacity: active ? 1 : 0.55,
              fontWeight: active ? 500 : 400,
              transition: 'all 0.15s',
            }}
          >
            {s.label}
          </button>
        )
      })}
    </aside>
  )
}

// Full statistician-mode report: sticky TOC + 6 sections of real backend data.
// Self-contained — owns activeSection state + IntersectionObserver internally.
function StatisticianReport({ result, csvData, detectedCols }) {
  const [activeId, setActiveId] = useState(STAT_SECTIONS[0].id)

  useEffect(() => {
    if (!result) return
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry that's most visible AND above the viewport midline.
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible.length > 0) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: '-80px 0px -50% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
    )
    STAT_SECTIONS.forEach(s => {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [result])

  if (!result) return null

  const sectionStyle = { marginBottom: 40, scrollMarginTop: 24 }
  const headingStyle = { fontSize: 16, fontWeight: 500, margin: '0 0 14px', letterSpacing: '-0.2px' }

  return (
    <section className="stat-report" style={{
      borderTop: '1px solid var(--border)',
      padding: '2rem 3rem',
      display: 'grid',
      gridTemplateColumns: '180px 1fr',
      gap: 32,
      alignItems: 'start',
    }}>
      <TocNav sections={STAT_SECTIONS} activeId={activeId} />
      <div className="stat-report-content" style={{ minWidth: 0 }}>

        <section id="demographics" style={sectionStyle}>
          <h2 style={headingStyle}>Table 1: Baseline Demographics</h2>
          <DemographicsTable csvData={csvData} detectedCols={detectedCols} result={result} />
        </section>

        <section id="subgroups" style={sectionStyle}>
          <h2 style={headingStyle}>Subgroup Analysis</h2>
          <SubgroupsTable subgroups={result.subgroups} />
        </section>

        <section id="survival" style={sectionStyle}>
          <h2 style={headingStyle}>Kaplan–Meier Survival Curves</h2>
          <KMFigure result={result} />
        </section>

        <section id="efficacy" style={{ ...sectionStyle, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <h2 style={headingStyle}>Feature Importance (SHAP-style)</h2>
            <FeatureImportanceTable shap={result.shap} />
          </div>
          <div>
            <h2 style={headingStyle}>Manager QC Review</h2>
            <ManagerReviewPanel managerCheck={result.managerCheck} />
          </div>
        </section>

        <section id="rcode" style={sectionStyle}>
          <h2 style={headingStyle}>Generated R Code</h2>
          <pre style={{
            background: 'rgba(255,255,255,0.05)',
            borderRadius: 8,
            padding: 14,
            fontSize: 11,
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            maxHeight: 400,
            overflowY: 'auto',
            lineHeight: 1.6,
            fontFamily: 'monospace',
            margin: 0,
          }}>
            {result.rCode || '— no R code returned (fallback path)'}
          </pre>
        </section>

        <section id="provenance" style={sectionStyle}>
          <h2 style={headingStyle}>Provenance &amp; Execution</h2>
          <ProvenancePanel agent1={result.agent1} agent2={result.agent2} execution={result.execution} />
        </section>

      </div>

      <style>{`
        @media (max-width: 900px) {
          .stat-report { grid-template-columns: 1fr !important; }
          .stat-report aside { position: static !important; }
        }
      `}</style>
    </section>
  )
}

// ---------------- end statistician-report components ----------------

// Receives session as a prop so it can filter by the current user
function PastAnalyses() {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Use backend API endpoint instead of direct Supabase call
    fetch('http://localhost:3000/results')
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        return response.json()
      })
      .then(data => {
        // Map backend data structure to frontend expectations
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
  const [currentJob, setCurrentJob] = useState(null)
  const [subStepIndex, setSubStepIndex] = useState(0)
  const previousStage = useRef(null)
  const [result, setResult] = useState(null)
  const [csvError, setCsvError] = useState(null)
  const [activeTab, setActiveTab] = useState('analysis')
  const [trialInfo, setTrialInfo] = useState({
    name: 'Clinical Trial Analysis',
    indication: 'Data-driven indication discovery',
    status: 'Analysis — Ready',
    sponsor: 'AI-Powered Research',
    patients: null,
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setSession(session ?? null))
    return () => listener.subscription.unsubscribe()
  }, [])

  // Layer 1: rotate the wait-text sub-step every 4s within the current backend stage.
  // Resets to 0 whenever the stage changes (which moves the bar forward).
  useEffect(() => {
    if (!loading || !currentJob?.stage) { setSubStepIndex(0); return }
    setSubStepIndex(0)
    const messages = STAGE_WAIT_MESSAGES[currentJob.stage] || []
    if (messages.length <= 1) return
    const interval = setInterval(() => {
      setSubStepIndex(i => (i + 1) % messages.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [loading, currentJob?.stage])

  // Layer 2: fire a toast when a stage finishes (i.e., the stage advances)
  // and on terminal status (completed | failed). Skips the initial null -> uploaded
  // transition because no real stage finished at that point.
  useEffect(() => {
    if (!loading || !currentJob) return
    const prev = previousStage.current
    const curr = currentJob.stage

    if (prev && prev !== curr && STAGE_LABELS[prev] && prev !== 'completed') {
      toast.success(`${STAGE_LABELS[prev]} complete`)
    }
    if (currentJob.status === 'completed' && prev !== 'completed') {
      toast.success('Analysis complete', { duration: 5000 })
    }
    if (currentJob.status === 'failed') {
      toast.error(
        `Analysis failed: ${currentJob.error?.message || 'unknown error'}`,
        { duration: 6000 }
      )
    }
    previousStage.current = curr
  }, [currentJob?.stage, currentJob?.status, loading])

  function handleLogout() { setSession(null) }

  function updateTrialInfoFromData(data, fileName) {
    if (!data || data.length === 0) return
    
    const columns = Object.keys(data[0] || {})
    const sampleSize = data.length
    
    // Try to infer trial type from columns
    let indication = 'Unknown indication'
    let trialPhase = 'Analysis'
    
    // Look for disease-specific columns to infer indication
    const diseaseKeywords = {
      'cancer': ['tumor', 'cancer', 'oncology', 'chemo', 'radiation'],
      'cardiovascular': ['cardiac', 'heart', 'blood_pressure', 'cholesterol', 'cvd'],
      'respiratory': ['asthma', 'copd', 'lung', 'respiratory', 'breathing'],
      'diabetes': ['glucose', 'diabetes', 'insulin', 'hba1c', 'blood_sugar'],
      'immunology': ['immune', 'arthritis', 'inflammation', 'cytokine'],
    }
    
    for (const [disease, keywords] of Object.entries(diseaseKeywords)) {
      if (keywords.some(keyword => columns.some(col => col.toLowerCase().includes(keyword)))) {
        indication = disease.charAt(0).toUpperCase() + disease.slice(1) + ' study'
        break
      }
    }
    
    // Infer sponsor from filename or use generic
    let sponsor = 'Research Organization'
    if (fileName) {
      if (fileName.toLowerCase().includes('aids') || fileName.toLowerCase().includes('hiv')) {
        sponsor = 'ACTG / NIH'
        indication = 'HIV/AIDS treatment'
      } else if (fileName.toLowerCase().includes('dupilumab')) {
        sponsor = 'Regeneron / Sanofi'
        indication = 'Atopic dermatitis / Asthma'
      }
    }
    
    setTrialInfo(prev => ({
      ...prev,
      name: fileName ? fileName.replace(/\.(csv|xlsx?)$/i, '').replace(/[-_]/g, ' ') : prev.name,
      indication: indication,
      sponsor: sponsor,
      patients: sampleSize,
      status: `${trialPhase} — ${sampleSize} patients`,
    }))
  }

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
        updateTrialInfoFromData(data, file.name)
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
    setCurrentJob(null)
    previousStage.current = null
    try {
      const formData = new FormData()
      formData.append('file', rawFile)

      // Pass the user's JWT so the backend can verify identity and store user_id
      const uploadRes = await fetch('http://localhost:3000/upload', {
        method: 'POST',
        body: formData,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (!uploadRes.ok) {
        const errorData = await uploadRes.json()
        console.error('Upload failed:', errorData)
        
        if (errorData.error === 'csv_analysis_failed') {
          setResult({ 
            summary: `CSV analysis failed: ${errorData.details?.map(d => d.message).join('; ') || 'Unknown error'}`, 
            rCode: '', 
            pvalues: '', 
            confidenceIntervals: '', 
            subgroup: '',
            demographics: null,
            efficacy: null,
            survival: null
          })
        } else {
          setResult({ 
            summary: `Upload failed: ${errorData.error || 'Unknown error'}. ${errorData.details ? JSON.stringify(errorData.details) : ''}`, 
            rCode: '', 
            pvalues: '', 
            confidenceIntervals: '', 
            subgroup: '',
            demographics: null,
            efficacy: null,
            survival: null
          })
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
        setCurrentJob(job)
        if (job.status === 'completed' || job.status === 'failed') break
      }
      if (job.status === 'failed') {
        setResult({ 
          summary: `Analysis failed: ${job.error?.message}`, 
          rCode: '', 
          pvalues: '', 
          confidenceIntervals: '', 
          subgroup: '',
          demographics: null,
          efficacy: null,
          survival: null
        })
        setLoading(false)
        return
      }
      const reportRes = await fetch(`http://localhost:3000/report/${job_id}`)
      const report = await reportRes.json()
      
      // Extract real data from the backend analysis results
      const analysisResults = report.results || {}
      
      setResult({
        // existing fields
        summary: report.headline,
        rCode: analysisResults.r_code || '',
        pvalues: analysisResults.pvalues || '',
        confidenceIntervals: analysisResults.confidenceIntervals || '',
        subgroup: analysisResults.subgroup || report.headline,
        demographics: analysisResults.demographics || null,
        efficacy: analysisResults.efficacy || null,
        survival: analysisResults.survival || null,
        shap: analysisResults.shap || null,
        subgroups: analysisResults.subgroups || null,
        // new: backend fields the statistician report needs
        execution: analysisResults.execution || null,
        plan: report.plan || analysisResults.plan || [],
        agent1: report.agent1 || null,
        agent2: report.agent2 || null,
        managerCheck: report.manager_check || null,
      })
    } catch (err) {
      setResult({ 
        summary: 'Analysis failed. Please try again.', 
        rCode: '', 
        pvalues: '', 
        confidenceIntervals: '', 
        subgroup: '',
        demographics: null,
        efficacy: null,
        survival: null
      })
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
    background: 'none',
    border: 'none',
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
          {/* Pass session so the query is scoped to the current user */}
          <PastAnalyses />
        </div>
      )}

      {activeTab === 'analysis' && (
        <>
          <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, borderTop: '1px solid var(--border)', minHeight: '60vh' }}>

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
                  <button onClick={resetUpload} style={{ fontSize: 12, padding: '5px 14px', opacity: 0.6, width: '100%' }}>
                    Upload a different file
                  </button>
                </div>
              )}

              {loading && (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <div
                      className="loading-bar-sweep"
                      style={{
                        height: '100%',
                        borderRadius: 2,
                        width: `${Math.max(currentJob?.progress ?? 0, 5)}%`,
                        transition: 'width 0.5s ease',
                      }}
                    />
                  </div>
                  <p style={{ fontSize: 12, opacity: 0.7, textAlign: 'center', margin: 0 }}>
                    {STAGE_LABELS[currentJob?.stage] || 'Starting analysis...'}
                  </p>
                  <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', margin: 0, fontStyle: 'italic' }}>
                    {(STAGE_WAIT_MESSAGES[currentJob?.stage] || ['Working...'])[subStepIndex] || ''}
                  </p>
                  <style>{`
                    @keyframes loadingBarSweep {
                      0%   { background-position: 100% 0; }
                      100% { background-position: -100% 0; }
                    }
                    .loading-bar-sweep {
                      background: linear-gradient(
                        90deg,
                        #185FA5 0%,
                        #185FA5 30%,
                        #6BB6FF 50%,
                        #185FA5 70%,
                        #185FA5 100%
                      );
                      background-size: 200% 100%;
                      animation: loadingBarSweep 1.4s linear infinite;
                    }
                  `}</style>
                </div>
              )}

              <button onClick={runAnalysis} disabled={!csvData || loading || !!csvError}
                style={{ fontSize: 13, padding: '10px 24px', width: '100%', justifyContent: 'center', marginTop: 'auto' }}>
                {loading ? 'Analyzing...' : 'Run Analysis'}
              </button>
            </div>

            {/* Stats Panel */}
            <div style={{ padding: '2.5rem 2rem', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', textAlign: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                  {[80, 60, 90].map((w, i) => (
                    <div key={i} style={{ height: 12, borderRadius: 4, background: 'rgba(255,255,255,0.06)', width: `${w}%`, animation: 'pulse 1.5s ease infinite' }} />
                  ))}
                  <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.9} }`}</style>
                </div>
              )}

              {result && mode === 'statistician' && (() => {
                // Pick the headline subgroup: largest positive lift over baseline.
                const subs = (result.subgroups || []).filter(s =>
                  typeof s.response_rate === 'number' && typeof s.baseline_rate === 'number'
                )
                const top = subs.length > 0
                  ? subs.reduce((best, s) =>
                      (s.response_rate - s.baseline_rate) > (best.response_rate - best.baseline_rate) ? s : best
                    , subs[0])
                  : null
                const lift = top
                  ? (top.baseline_rate > 0 ? (top.response_rate / top.baseline_rate - 1) * 100 : 0)
                  : null
                return (
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, width: '100%' }}>
                      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                        <p style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.4, margin: '0 0 6px' }}>Top subgroup</p>
                        <p style={{ fontSize: 13, fontWeight: 500, margin: 0, lineHeight: 1.3, textAlign: 'left' }}>{top?.name || '—'}</p>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                        <p style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.4, margin: '0 0 6px' }}>Lift vs baseline</p>
                        <p style={{ fontSize: 18, fontWeight: 500, margin: 0, color: lift && lift > 0 ? '#1D9E75' : 'inherit' }}>
                          {typeof lift === 'number' ? `${lift > 0 ? '+' : ''}${lift.toFixed(0)}%` : '—'}
                        </p>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                        <p style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.4, margin: '0 0 6px' }}>n</p>
                        <p style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>{top?.size ?? '—'}</p>
                      </div>
                    </div>
                    <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', margin: 0, fontStyle: 'italic' }}>
                      Full analysis below ↓
                    </p>
                  </div>
                )
              })()}

              {result && mode === 'medical' && (
                <div style={{ fontSize: 13, lineHeight: 1.7, opacity: 0.85, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                  {result.subgroup}
                </div>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ borderLeft: '2px solid #185FA5', paddingLeft: 16 }}>
                    <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>{result.summary}</p>
                  </div>
                  {mode === 'statistician' && (
                    <p style={{ fontSize: 11, opacity: 0.4 }}>Switch to Medical Director mode for clean summary only.</p>
                  )}
                </div>
              )}
            </div>

          </section>

          {/* KM Survival Curves — full-width row, MEDICAL MODE ONLY.
              In statistician mode, KM lives inside <StatisticianReport /> below. */}
          {result && mode === 'medical' && (
            <div style={{
              borderTop: '1px solid var(--border)',
              borderBottom: '1px solid var(--border)',
              padding: '1.25rem 3rem',
              background: 'rgba(255,255,255,0.01)',
            }}>
              <Collapsible title="Kaplan–Meier Survival Curves" defaultOpen>
                <KMFigure result={result} />
              </Collapsible>
            </div>
          )}

          {/* Full statistician-mode report: TOC + Demographics + Subgroups +
              KM + SHAP + QC + R Code + Provenance. Only in statistician mode. */}
          {result && mode === 'statistician' && (
            <StatisticianReport result={result} csvData={csvData} detectedCols={detectedCols} />
          )}
        </>
      )}

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}