import { auth } from "@zitadel/sdk-next/server";
import { LogoutWidget } from "./widget";
import { SessionDetails } from "./session-details";
import { UserBadge } from "./user-badge";

export default async function AdminPage() {
  const session = await auth();

  return (
    <main style={{ padding: "48px", maxWidth: "600px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Admin</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <UserBadge />
          <LogoutWidget />
        </div>
      </div>
      {session.isAuthenticated ? <SessionDetails /> : <p style={{ color: "#6b7280" }}>Not signed in</p>}
    </main>
  );
}
