import { useState } from 'react'
import { supabase } from './lib/supabaseClient'

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [form, setForm] = useState({ firstName: '', lastName: '', username: '', password: '' })
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  async function handleSubmit() {
    setError(null)
    setLoading(true)

    // Supabase uses email under the hood — we use username@app.local as a fake email
    const fakeEmail = `${form.username}@gmail.com`

    if (mode === 'signup') {
      const { error: signUpError } = await supabase.auth.signUp({
        email: fakeEmail,
        password: form.password,
        options: {
          data: {
            first_name: form.firstName,
            last_name: form.lastName,
            username: form.username,
          }
        }
      })
      if (signUpError) { setError(signUpError.message); setLoading(false); return }
    }

    if (mode === 'login') {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: fakeEmail,
        password: form.password,
      })
      if (signInError) { setError(signInError.message); setLoading(false); return }
    }

    setLoading(false)
    onAuth()
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-background-tertiary)' }}>
      <div style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 16, padding: '2rem', width: 360 }}>
        
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>TrialLens</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
          {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'signup' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>First name</label>
                <input value={form.firstName} onChange={update('firstName')} placeholder="Jane" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Last name</label>
                <input value={form.lastName} onChange={update('lastName')} placeholder="Smith" style={{ width: '100%' }} />
              </div>
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Username</label>
            <input value={form.username} onChange={update('username')} placeholder="jsmith" style={{ width: '100%' }} />
          </div>

          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Password</label>
            <input type="password" value={form.password} onChange={update('password')} placeholder="••••••••" style={{ width: '100%' }} />
          </div>

          {error && (
            <p style={{ fontSize: 12, color: 'var(--color-text-danger)', background: 'var(--color-background-danger)', padding: '8px 12px', borderRadius: 8 }}>{error}</p>
          )}

          <button onClick={handleSubmit} disabled={loading} style={{ marginTop: 4, width: '100%', justifyContent: 'center' }}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'center', marginTop: 20 }}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <span onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null) }}
            style={{ color: '#185FA5', cursor: 'pointer' }}>
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </span>
        </p>
      </div>
    </div>
  )
}