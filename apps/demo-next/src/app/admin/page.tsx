import { auth } from "@zitadel/sdk-next/server";

export default async function AdminPage() {
  const session = await auth();
  return (
    <main style={{ padding: "48px", maxWidth: "600px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 700 }}>Admin</h1>
      <p style={{ color: "#6b7280" }}>
        Signed in as {session.isAuthenticated ? session.session.email : "unknown"}
      </p>
    </main>
  );
}
