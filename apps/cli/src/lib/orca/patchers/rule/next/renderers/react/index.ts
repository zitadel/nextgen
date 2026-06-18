import { MANAGED_MARKER } from "../../../../../../paths";
import type { RendererSpec } from "../types";

/**
 * The Next.js App Router renderer scaffolds `/login`, `/register`, and
 * `/profile` pages that render the `<ZitadelLogin>` / `<ZitadelLogout>` React
 * components from `@zitadel/sdk-next/react`.
 *
 * Those components wrap the Lit web components (via `@lit/react`): the server
 * renders the inert tag and the client upgrades it, and the SDK `project`
 * handle is bound as a DOM property. The React components are fully typed, so
 * there is no `next/dynamic({ ssr: false })` and no `custom-elements.d.ts`.
 *
 * The pages are marked `"use client"`. `configureZitadel()` stores the SDK
 * handle on a `globalThis` singleton that the web component reads at startup
 * (`getZitadelConfig()`). That call must run in the browser to populate the
 * client-side global — in a plain Server Component it would run only on the
 * server, leaving the browser global empty and the widget unable to start its
 * flow. `"use client"` keeps SSR (the inert tag is still server-rendered) while
 * ensuring `configureZitadel()` also runs on the client.
 *
 * `configureZitadel({ projectId, proxyPath: "/__nextgen" })` builds the handle;
 * the backend URL never reaches the browser (the client talks to the
 * same-origin `/__nextgen` proxy, which the scaffolded request boundary forwards
 * to `ZITADEL_URL` server-side). `NEXT_PUBLIC_ZITADEL_PROJECT_ID` is public —
 * the project id is not sensitive and the widget needs it to start a flow.
 */
export const reactRenderer: RendererSpec = {
  id: "react",
  displayName: "React (Next.js App Router)",
  status: "available",
  frameworks: ["next"],
  dependency: { name: "@zitadel/sdk-next", version: "latest" },
  templates: {
    authPage(mode) {
      const componentName = mode === "login" ? "LoginPage" : "RegisterPage";
      return {
        mode,
        contents: `${MANAGED_MARKER}
"use client";
import { ZitadelLogin } from "@zitadel/sdk-next/react";
import { configureZitadel } from "@zitadel/sdk-next/client";
import Link from "next/link";

const project = configureZitadel({
  projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "",
  proxyPath: "/__nextgen",
});

export default function ${componentName}() {
  return (
    <main style={{ minHeight: "100vh", position: "relative", background: "#0f0f11" }}>
      <nav aria-label="Authentication" style={{ position: "absolute", top: "24px", right: "24px", zIndex: 1, display: "flex", gap: "12px" }}>
        <Link href="${mode === "login" ? "/register" : "/login"}" style={{ color: "#f4f4f6", fontWeight: 700, textDecoration: "none" }}>
          ${mode === "login" ? "Create account" : "Sign in"}
        </Link>
      </nav>
      <ZitadelLogin project={project} purpose="${mode}" postSignInUrl="/profile" />
    </main>
  );
}
`,
      };
    },
    profilePage() {
      return {
        contents: `${MANAGED_MARKER}
"use client";
import { ZitadelLogout } from "@zitadel/sdk-next/react";
import { configureZitadel } from "@zitadel/sdk-next/client";
import { useEffect, useState } from "react";

type SessionProof = {
  session_id?: string;
  state?: string;
  user_id?: string;
};

const project = configureZitadel({
  projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "",
  proxyPath: "/__nextgen",
});

export default function ProfilePage() {
  const [session, setSession] = useState<SessionProof | null>(null);
  const [sessionError, setSessionError] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetch("/__nextgen/sessions/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Session check failed: " + String(response.status));
        }
        return response.json() as Promise<SessionProof>;
      })
      .then((nextSession) => {
        if (!cancelled) {
          setSession(nextSession);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSessionError(error instanceof Error ? error.message : "Session check failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ padding: "48px", maxWidth: "680px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Signed in</h1>
        <ZitadelLogout project={project} postSignOutUrl="/login" />
      </div>
      <p style={{ color: "#166534", fontWeight: 600 }}>Signed in profile loaded.</p>
      {session ? (
        <dl style={{ display: "grid", gap: "12px", marginTop: "24px" }}>
          <div>
            <dt style={{ color: "#6b7280", fontSize: "14px" }}>Session state</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{session.state ?? "active"}</dd>
          </div>
          <div>
            <dt style={{ color: "#6b7280", fontSize: "14px" }}>User id</dt>
            <dd style={{ margin: 0, fontFamily: "monospace" }}>{session.user_id ?? "available"}</dd>
          </div>
        </dl>
      ) : (
        <p style={{ color: sessionError ? "#b91c1c" : "#6b7280" }}>
          {sessionError || "Checking session..."}
        </p>
      )}
    </main>
  );
}
`,
      };
    },
  },
};
