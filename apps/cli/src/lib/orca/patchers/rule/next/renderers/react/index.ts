import { MANAGED_MARKER } from "../../../../../../paths";
import type { RendererSpec } from "../types";

/**
 * The Next.js App Router renderer scaffolds `/login`, `/register`, and
 * `/profile` pages that drive the `<zitadel-login>` and `<zitadel-session>`
 * Lit web components. `/profile` is the post-sign-in "signed in as" card.
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
    <main style={{ minHeight: "100vh", colorScheme: "dark", background: "#0f0f11" }}>
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

const ZitadelSession = dynamic(
  async () => {
    const { configureZitadel } = await import("@zitadel/sdk-next/client");
    // Build the SDK project handle and pass it to the session card via the
    // \`project\` prop. The card reads identity from "/__nextgen/sessions/me"
    // and exposes a Sign out action.
    const project = configureZitadel({
      projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "",
      proxyPath: "/__nextgen",
    });
    return function ZitadelSessionElement() {
      return (
        <zitadel-session
          project={project}
          post-sign-out-url="/login"
        />
      );
    };
  },
  { ssr: false },
);

export default function ProfilePage() {
  return (
    <main style={{ minHeight: "100vh", colorScheme: "dark", background: "#0f0f11" }}>
      <ZitadelSession />
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
      "zitadel-session": React.HTMLAttributes<HTMLElement> & {
        project?: ZitadelProject;
        "post-sign-out-url"?: string;
        heading?: string;
        "logout-label"?: string;
      };
    }
  }
}
`,
      };
    },
  },
};
