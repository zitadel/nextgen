import { MANAGED_MARKER } from "../../../../../paths";
import type { RendererSpec } from "./types";

export const litRenderer: RendererSpec = {
  id: "web-component",
  displayName: "Web component (<zitadel-flow>)",
  status: "not-implemented",
  frameworks: ["next", "astro", "remix", "sveltekit", "nuxt", "vanilla"],
  dependency: { name: "@zitadel/ui-lit", version: "workspace:*" },
  templates: {
    authPage(mode) {
      const purpose = mode === "login" ? "login" : "register";
      return {
        mode,
        contents: `${MANAGED_MARKER}
import "@zitadel/ui-lit";

const environment =
  process.env.ZITADEL_ENVIRONMENT ??
  (process.env.NODE_ENV === "production" ? "production" : "development");

export default function ${mode === "login" ? "LoginPage" : "RegisterPage"}() {
  return (
    <zitadel-flow
      purpose="${purpose}"
      project-id={process.env.ZITADEL_PROJECT_ID}
      issuer={process.env.ZITADEL_ISSUER}
      environment={environment}
    />
  );
}
`,
      };
    },
  },
};
