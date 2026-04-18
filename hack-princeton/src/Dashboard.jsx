import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import Auth from './Auth'

export default function Dashboard() {
  const [session, setSession] = useState(undefined) // undefined = loading

  useEffect(() => {
  supabase.auth.getSession().then(({ data }) => {
    setSession(data.session ?? null)  // explicitly set null if no session
  })

  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    setSession(session ?? null)
  })

  return () => listener.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <p style={{ padding: '2rem' }}>Loading...</p>
  if (!session) return <Auth onAuth={(user) => setSession(user)} />

  return (
    <>
      <section id="center">
        <div>
          <h1>Dashboard</h1>
          <p>Your data, visualized.</p>
        </div>
      </section>

      <div className="ticks"></div>

      <section id="next-steps">
        {/* Upload Panel */}
        <div id="docs">
          <h2>📁 Upload</h2>
          <p>File upload area — coming soon.</p>
        </div>

        {/* Charts Panel */}
        <div>
          <h2>📊 Charts</h2>
          <p>Data visualizations will appear here.</p>
        </div>

        {/* AI Output Panel */}
        <div>
          <h2>🤖 AI Output</h2>
          <p>AI-generated insights will display here.</p>
        </div>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}