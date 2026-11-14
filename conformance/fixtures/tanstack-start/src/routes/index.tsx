// zitadel-cli: managed-file v1
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main style={{ position: "fixed", inset: 0, padding: "48px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f0f11", colorScheme: "dark", color: "#f4f4f6", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", lineHeight: 1.5, letterSpacing: "normal", textAlign: "center" }}>
      <section style={{ width: "100%", maxWidth: "560px" }}>
        <p style={{ margin: "0 0 12px", color: "#9ca3af", fontSize: "14px" }}>Zitadel auth</p>
        <h1 style={{ margin: "0 0 24px", fontSize: "32px", lineHeight: 1.15, fontWeight: 600, color: "#f4f4f6" }}>Sign in, create an account, or open your profile.</h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "center" }}>
          <Link to="/login" style={{ padding: "10px 16px", borderRadius: "8px", background: "#f4f4f6", color: "#0f0f11", textDecoration: "none", fontWeight: 600, fontSize: "14px" }}>
            Sign in
          </Link>
          <Link to="/register" style={{ padding: "10px 16px", borderRadius: "8px", border: "1px solid #3f3f46", color: "#f4f4f6", textDecoration: "none", fontWeight: 600, fontSize: "14px" }}>
            Create account
          </Link>
          <Link to="/profile" style={{ padding: "10px 16px", borderRadius: "8px", border: "1px solid #3f3f46", color: "#f4f4f6", textDecoration: "none", fontWeight: 600, fontSize: "14px" }}>
            Profile
          </Link>
        </div>
      </section>
    </main>
  );
}
