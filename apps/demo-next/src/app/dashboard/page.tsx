import { auth } from "@zitadel/sdk-next/server";
import { DEMO_PROJECT_ID } from "../../project";

/**
 * A protected page a sign-in can return to (see `proxy.ts`). It says who is
 * signed in from `auth()`, the session the middleware judged for this
 * project, and never renders a cookie or a token.
 */
export default async function DashboardPage() {
  const session = await auth({ projectId: DEMO_PROJECT_ID });
  const who = session.isAuthenticated
    ? (session.session.display ?? session.session.identifier ?? session.session.userId)
    : null;

  return (
    <main style={{ padding: "48px", maxWidth: "600px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 700 }}>Dashboard</h1>
      <p style={{ color: "#6b7280" }}>{who ? `Signed in as ${who}.` : "Not signed in"}</p>
    </main>
  );
}
