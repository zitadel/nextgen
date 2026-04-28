import { MANAGED_MARKER } from "../../lib/paths";
import type { RendererSpec } from "../types";

export const reactRenderer: RendererSpec = {
  id: "react",
  displayName: "React (sdk-next bridge)",
  status: "available",
  frameworks: ["next"],
  dependency: { name: "@zitadel/sdk-next", version: "latest" },
  templates: {
    authPage(mode) {
      const componentName = mode === "login" ? "LoginPage" : "RegisterPage";
      return {
        mode,
        contents: `${MANAGED_MARKER}
import { ZitadelFlow, type ZitadelEnvironment } from "@zitadel/sdk-next";

const rawEnvironment =
  process.env.ZITADEL_ENVIRONMENT ??
  (process.env.NODE_ENV === "production" ? "production" : "development");

function parseZitadelEnvironment(value: string): ZitadelEnvironment {
  if (value === "development" || value === "preview" || value === "production") {
    return value;
  }
  throw new Error(\`Unsupported ZITADEL_ENVIRONMENT "\${value}". Use development, preview, or production.\`);
}

const environment = parseZitadelEnvironment(rawEnvironment);

export default function ${componentName}() {
  return (
    <ZitadelFlow
      purpose="${mode}"
      projectId={process.env.ZITADEL_PROJECT_ID}
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
