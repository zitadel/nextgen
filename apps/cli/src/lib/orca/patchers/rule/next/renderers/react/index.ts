import { MANAGED_MARKER } from "../../../../../../paths";
import type { RendererSpec } from "../types";

/**
 * The Next.js App Router renderer scaffolds `/login`, `/register`, and
 * `/profile` pages that render the `<ZitadelLogin>` / `<ZitadelLogout>` React
 * components from `@zitadel-nextgen/sdk-next/react`.
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
 * same-origin `/__nextgen` proxy, which the scaffolded `middleware.ts` forwards
 * to `ZITADEL_URL` server-side). `NEXT_PUBLIC_ZITADEL_PROJECT_ID` is public —
 * the project id is not sensitive and the widget needs it to start a flow.
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
      return {
        mode,
        contents: `${MANAGED_MARKER}
"use client";
import { ZitadelLogin } from "@zitadel-nextgen/sdk-next/react";
import { configureZitadel } from "@zitadel-nextgen/sdk-next/client";

const project = configureZitadel({
  projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "",
  proxyPath: "/__nextgen",
});

export default function ${componentName}() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
import { ZitadelLogout } from "@zitadel-nextgen/sdk-next/react";
import { configureZitadel } from "@zitadel-nextgen/sdk-next/client";

const project = configureZitadel({
  projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "",
  proxyPath: "/__nextgen",
});

export default function ProfilePage() {
  return (
    <main style={{ padding: "48px", maxWidth: "600px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Signed in</h1>
        <ZitadelLogout project={project} postSignOutUrl="/login" />
      </div>
      <p style={{ color: "#6b7280" }}>You are signed in. Use the button above to log out.</p>
    </main>
  );
}
`,
      };
    },
  },
};
