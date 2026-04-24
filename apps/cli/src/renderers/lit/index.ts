import { MANAGED_MARKER } from "../../lib/paths";
import type { RendererSpec } from "../types";

export const litRenderer: RendererSpec = {
  id: "lit",
  displayName: "Lit web component (BDUI)",
  status: "not-implemented",
  frameworks: ["next", "astro", "remix", "sveltekit", "nuxt", "vanilla"],
  dependency: { name: "@zitadel/ui-lit", version: "workspace:*" },
  templates: {
    authPage(mode) {
      const purpose = mode === "login" ? "login" : "register";
      const title = mode === "login" ? "Sign in" : "Create account";
      return {
        mode,
        contents: `${MANAGED_MARKER}
// The Lit renderer ships a <zitadel-flow> web component. Until
// @zitadel/ui-lit is published, this template only declares the
// intended integration point. See docs/design/cli/bdui-renderer.md.
import "@zitadel/ui-lit";

export default function ${mode === "login" ? "LoginPage" : "RegisterPage"}() {
  return (
    <zitadel-flow
      purpose="${purpose}"
      title="${title}"
    />
  );
}
`,
      };
    },
  },
};
