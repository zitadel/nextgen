export default function Home() {
  return (
    <main style={{ padding: "48px", maxWidth: "600px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 700 }}>Home</h1>
      <p style={{ color: "#6b7280" }}>This page is public.</p>
      <a href="/admin" style={{ color: "#6366f1" }}>
        Go to Admin
      </a>
    </main>
  );
}
