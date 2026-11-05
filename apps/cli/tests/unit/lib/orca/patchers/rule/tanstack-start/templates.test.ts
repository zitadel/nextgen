import { describe, expect, it } from "vitest";

import {
  loginRouteTemplate,
  profileRouteTemplate,
  registerRouteTemplate,
  startTemplate,
} from "../../../../../../../src/lib/orca/patchers/rule/tanstack-start/templates";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";

/** What `@tanstack/react-start` 1.168.10, the detector floor, exports and the templates may import. */
const FLOOR_EXPORTS = [
  "createClientOnlyFn",
  "createCsrfMiddleware",
  "createIsomorphicFn",
  "createMiddleware",
  "createServerFn",
  "createServerOnlyFn",
  "createStart",
];

const context: PatchContext = {
  framework: { id: "tanstack-start", appDir: "src", devPort: 3000, url: "http://localhost:3000" },
  rendererId: "react",
  project: {
    id: "proj-1",
    project_secret: "sk_full",
    preview_secret: "sk_preview",
    origins: [],
    created_at: "2026-01-01T00:00:00.000Z",
  },
  issuer: "http://localhost:3000",
  server: "https://api.zitadel.cloud",
  cliVersion: "0.1.0-alpha.0",
};

function reactStartImports(source: string): string[] {
  return [...source.matchAll(/import \{([^}]*)\} from "@tanstack\/react-start";/g)].flatMap(
    (match) => (match[1] ?? "").split(",").map((name) => name.trim()),
  );
}

describe("TanStack Start templates", () => {
  it("import only names the floor release of @tanstack/react-start exports", () => {
    const sources = [
      startTemplate(),
      profileRouteTemplate(),
      loginRouteTemplate(context),
      registerRouteTemplate(context),
    ];
    const imported = sources.flatMap(reactStartImports);

    expect(imported).toContain("createCsrfMiddleware");
    for (const name of imported) {
      expect(FLOOR_EXPORTS).toContain(name);
    }
  });
});
