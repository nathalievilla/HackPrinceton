import './App.css'

export default function Dashboard() {
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
