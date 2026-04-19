import { useState } from 'react'
import { supabase } from './lib/supabaseClient'

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ firstName: '', lastName: '', username: '', password: '' })
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  async function handleSubmit() {
    setError(null)
    setLoading(true)
    const username = form.username.toLowerCase().trim()

    if (mode === 'signup') {
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .single()

      if (existing) { setError('Username already taken.'); setLoading(false); return }

      const { error: insertError } = await supabase
        .from('users')
        .insert({
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          username,
          password: form.password,
        })

      if (insertError) { setError(insertError.message); setLoading(false); return }
      onAuth({ username, firstName: form.firstName.trim() })
    }

    if (mode === 'login') {
      const { data: user, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .eq('password', form.password)
        .single()

      if (fetchError || !user) { setError('Invalid username or password.'); setLoading(false); return }
      onAuth({ username: user.username, firstName: user.first_name })
    }

    setLoading(false)
  }

  const inputStyle = {
    width: '100%',
    padding: '14px 16px',
    fontSize: 15,
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    color: 'inherit',
    outline: 'none',
    boxSizing: 'border-box'
  }

  const labelStyle = {
    fontSize: 13,
    opacity: 0.5,
    display: 'block',
    marginBottom: 8,
    letterSpacing: '0.03em'
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ width: '100%', maxWidth: 460, padding: '0 24px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h1 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-1px', marginBottom: 10 }}>
            BioStrata
          </h1>
          <p style={{ fontSize: 15, opacity: 0.5 }}>
            {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
          </p>
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {mode === 'signup' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>First name</label>
                <input value={form.firstName} onChange={update('firstName')} placeholder="Jane" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Last name</label>
                <input value={form.lastName} onChange={update('lastName')} placeholder="Smith" style={inputStyle} />
              </div>
            </div>
          )}

          <div>
            <label style={labelStyle}>Username</label>
            <input value={form.username} onChange={update('username')} placeholder="jsmith" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Password</label>
            <input type="password" value={form.password} onChange={update('password')} placeholder="••••••••" style={inputStyle} />
          </div>

          {error && (
            <div style={{
              fontSize: 13, color: '#f87171',
              background: 'rgba(248,113,113,0.1)',
              border: '1px solid rgba(248,113,113,0.2)',
              padding: '12px 16px', borderRadius: 8
            }}>
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              fontSize: 15,
              fontWeight: 500,
              borderRadius: 10,
              border: 'none',
              background: '#185FA5',
              color: 'white',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              transition: 'opacity 0.2s',
              marginTop: 4
            }}
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </div>

        {/* Switch mode */}
        <p style={{ fontSize: 14, opacity: 0.5, textAlign: 'center', marginTop: 32 }}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <span
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null) }}
            style={{ color: '#185FA5', cursor: 'pointer', opacity: 1 }}
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </span>
        </p>

      </div>
    </div>
  )
}