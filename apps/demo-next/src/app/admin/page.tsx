import { auth } from "@zitadel-nextgen/sdk-next/server";
import { LogoutWidget } from "./widget";

export default async function AdminPage() {
  const session = await auth();

  return (
    <main style={{ padding: "48px", maxWidth: "600px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Admin</h1>
        <LogoutWidget />
      </div>
      <p style={{ color: "#6b7280" }}>
        Signed in as {session.isAuthenticated ? session.session.email : "unknown"}
      </p>
    </main>
  );
}
