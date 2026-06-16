import { MANAGED_MARKER } from "../../../../../../paths";
import type { RendererSpec } from "../types";

/**
 * The Next.js App Router renderer scaffolds `/login`, `/register`, and
 * `/profile` pages that drive the `<zitadel-login>` and `<zitadel-logout>`
 * Lit web components.
 *
 * Each page is a single client component (`"use client"`) that, inside a
 * `next/dynamic({ ssr: false })` loader, builds the SDK project handle with
 * `configureZitadel({ projectId, proxyPath: "/__nextgen" })` and passes it to
 * the widget via `project={...}`. It also imports
 * `@zitadel/sdk-next/client` for its `customElements.define`
 * side-effect — importing `@zitadel/components` directly would fail on
 * strict-resolution package managers (pnpm, yarn PnP) because the app only
 * declares `sdk-next` as a direct dep. SSR is disabled because Lit's element
 * registration needs a browser.
 *
 * The handle is passed as the `project` DOM property, which relies on React
 * 19's custom-element property binding (the scaffold targets the latest Next /
 * React). The backend URL never reaches the browser: the client talks to the
 * same-origin `/__nextgen` proxy path, and the scaffolded Next request boundary
 * forwards it to `ZITADEL_URL` server-side. `NEXT_PUBLIC_ZITADEL_PROJECT_ID` is
 * public — the project id is not sensitive and the widget needs it to start a
 * flow.
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
      const elementName = mode === "login" ? "ZitadelLogin" : "ZitadelRegister";
      return {
        mode,
        contents: `${MANAGED_MARKER}
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const ${elementName} = dynamic(
  async () => {
    const { configureZitadel } = await import("@zitadel/sdk-next/client");
    // Build the SDK project handle and pass it to the component via the
    // \`project\` prop. The component reads config from this prop directly, so
    // it works regardless of how the SDK packages are bundled. The backend URL
    // stays server-side: requests go through the proxy path "/__nextgen",
    // which the scaffolded request boundary forwards to the Zitadel server.
    const project = configureZitadel({
      projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "",
      proxyPath: "/__nextgen",
    });
    return function ${elementName}Element() {
      return (
        <zitadel-login
          project={project}
          purpose="${mode}"
          post-sign-in-url="/profile"
        />
      );
    };
  },
  { ssr: false },
);

export default function ${componentName}() {
  return (
    <main style={{ minHeight: "100vh", position: "relative", background: "#0f0f11" }}>
      <nav aria-label="Authentication" style={{ position: "absolute", top: "24px", right: "24px", zIndex: 1, display: "flex", gap: "12px" }}>
        <Link href="${mode === "login" ? "/register" : "/login"}" style={{ color: "#f4f4f6", fontWeight: 700, textDecoration: "none" }}>
          ${mode === "login" ? "Create account" : "Sign in"}
        </Link>
      </nav>
      <${elementName} />
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

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

type SessionProof = {
  session_id?: string;
  state?: string;
  user_id?: string;
};

const ZitadelLogout = dynamic(
  async () => {
    const { configureZitadel } = await import("@zitadel/sdk-next/client");
    const project = configureZitadel({
      projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "",
      proxyPath: "/__nextgen",
    });
    return function ZitadelLogoutElement() {
      return (
        <zitadel-logout
          project={project}
          post-sign-out-url="/login"
        />
      );
    };
  },
  { ssr: false },
);

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
        <ZitadelLogout />
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
    customElementsDts() {
      return {
        contents: `${MANAGED_MARKER}
import type React from "react";
import type { ZitadelProject } from "@zitadel/sdk-next/client";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "zitadel-login": React.HTMLAttributes<HTMLElement> & {
        project?: ZitadelProject;
        "session-exchange-path"?: string;
        "post-sign-in-url"?: string;
        purpose?: string;
      };
      "zitadel-logout": React.HTMLAttributes<HTMLElement> & {
        project?: ZitadelProject;
        "post-sign-out-url"?: string;
      };
    }
  }
}
`,
      };
    },
  },
};
