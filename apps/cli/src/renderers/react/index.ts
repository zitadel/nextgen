import { MANAGED_MARKER } from "../../lib/paths";
import type { RendererSpec } from "../types";

export const reactRenderer: RendererSpec = {
  id: "react",
  displayName: "React (sdk-next bridge)",
  status: "available",
  frameworks: ["next"],
  dependency: { name: "@zitadel/sdk-next", version: "latest" },
  templates: {
    provider: {
      filename: "zitadel-provider.tsx",
      contents: `${MANAGED_MARKER}
"use client";

import { ZitadelProvider } from "@zitadel/sdk-next";
import type { ReactNode } from "react";

export function ZitadelAppProvider({ children }: { children: ReactNode }) {
  return <ZitadelProvider>{children}</ZitadelProvider>;
}
`,
    },
    authPage(mode) {
      const title = mode === "login" ? "Sign in" : "Create account";
      const componentName = mode === "login" ? "LoginPage" : "RegisterPage";
      return {
        mode,
        contents: `${MANAGED_MARKER}
import { ZitadelAuth } from "@zitadel/sdk-next";

export default function ${componentName}() {
  return <ZitadelAuth mode="${mode}" title="${title}" />;
}
`,
      };
    },
  },
};
