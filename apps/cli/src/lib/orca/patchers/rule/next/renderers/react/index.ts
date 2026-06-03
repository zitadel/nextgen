import { MANAGED_MARKER } from "../../../../../../paths";
import type { RendererSpec } from "../types";

/**
 * The Next.js App Router renderer scaffolds `/login`, `/register`, and
 * `/profile` pages that drive the `<zitadel-login>` and `<zitadel-logout>`
 * Lit web components.
 *
 * Each page is a single client component (`"use client"`) that imports
 * `@zitadel-nextgen/sdk-next/client` via `next/dynamic({ ssr: false })`.
 * That subpath re-exports from `@zitadel-nextgen/components`, so the
 * `customElements.define` side-effect fires; importing components
 * directly would fail on strict-resolution package managers (pnpm,
 * yarn PnP) because the user only declares `sdk-next` as a direct dep.
 * SSR is disabled because Lit's element registration needs a browser.
 *
 * `api-base` is hardcoded to `/__nextgen`: the scaffolded Next `middleware.ts`
 * intercepts that path and forwards same-origin requests to `ZITADEL_URL`
 * (server-side only). The backend URL therefore never reaches the browser
 * bundle. `NEXT_PUBLIC_ZITADEL_PROJECT_ID` is still public — the project ID
 * is not sensitive and the web component needs it to start a flow.
 */
export const reactRenderer: RendererSpec = {
  id: "react",
  displayName: "React (Next.js App Router)",
  status: "available",
  frameworks: ["next"],
  dependency: { name: "@zitadel-nextgen/sdk-next", version: "latest" },
  templates: {
    authPage(mode) {
      const componentName = mode === "login" ? "LoginPage" : "RegisterPage";
      const elementName = mode === "login" ? "ZitadelLogin" : "ZitadelRegister";
      return {
        mode,
        contents: `${MANAGED_MARKER}
"use client";

import dynamic from "next/dynamic";

const ${elementName} = dynamic(
  async () => {
    await import("@zitadel-nextgen/sdk-next/client");
    return function ${elementName}Element() {
      return (
        <zitadel-login
          api-base="/__nextgen"
          project-id={process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID}
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
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
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

const ZitadelLogout = dynamic(
  async () => {
    await import("@zitadel-nextgen/sdk-next/client");
    return function ZitadelLogoutElement() {
      return (
        <zitadel-logout
          api-base="/__nextgen"
          post-sign-out-url="/login"
        />
      );
    };
  },
  { ssr: false },
);

export default function ProfilePage() {
  return (
    <main style={{ padding: "48px", maxWidth: "600px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Signed in</h1>
        <ZitadelLogout />
      </div>
      <p style={{ color: "#6b7280" }}>You are signed in. Use the button above to log out.</p>
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

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "zitadel-login": React.HTMLAttributes<HTMLElement> & {
        "api-base"?: string;
        "session-exchange-path"?: string;
        "post-sign-in-url"?: string;
        purpose?: string;
        "project-id"?: string;
        issuer?: string;
      };
      "zitadel-logout": React.HTMLAttributes<HTMLElement> & {
        "api-base"?: string;
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
