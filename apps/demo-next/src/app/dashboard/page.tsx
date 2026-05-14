import { cookies } from "next/headers";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("__nextgen_session");

  return (
    <main style={{ padding: "48px", maxWidth: "600px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 700 }}>Dashboard</h1>
      <p style={{ color: "#6b7280" }}>You are authenticated.</p>
      {session && (
        <pre
          style={{
            background: "#f3f4f6",
            padding: "16px",
            borderRadius: "8px",
            fontSize: "12px",
            overflowX: "auto",
          }}
        >
          {session.value}
        </pre>
      )}
    </main>
  );
}
