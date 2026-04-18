export default function Dashboard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Dashboard</h1>

      {/* Upload Panel */}
      <div style={{ border: "1px dashed #aaa", borderRadius: "8px", padding: "2rem", background: "#fafafa" }}>
        <h2>📁 Upload</h2>
        <p style={{ color: "#888" }}>File upload area — coming soon.</p>
      </div>

      {/* Charts Panel */}
      <div style={{ border: "1px dashed #aaa", borderRadius: "8px", padding: "2rem", background: "#fafafa" }}>
        <h2>📊 Charts</h2>
        <p style={{ color: "#888" }}>Data visualizations will appear here.</p>
      </div>

      {/* AI Output Panel */}
      <div style={{ border: "1px dashed #aaa", borderRadius: "8px", padding: "2rem", background: "#fafafa" }}>
        <h2>🤖 AI Output</h2>
        <p style={{ color: "#888" }}>AI-generated insights will display here.</p>
      </div>
    </div>
  );
}