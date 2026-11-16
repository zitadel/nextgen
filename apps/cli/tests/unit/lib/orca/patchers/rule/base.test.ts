import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect } from "vitest";

import { type ProjectMetaSchema, projectMetaSchemas } from "@/lib/meta-schemas";
import type { FileOp, ScaffoldPlan } from "@/lib/orca/patchers/rule/file-writer/types";
import { ReactPatcher } from "@/lib/orca/patchers/rule/react";
import type { PatchContext } from "@/lib/orca/patchers/types";
import { it } from "@tests/helpers/fixtures";
import { write } from "@tests/helpers/git-repo";

/**
 * The CLI version the patcher scaffolds for.
 */
const CLI_VERSION = "0.1.0-alpha.0";

/**
 * The project file the base ops write.
 */
const ZITADEL_JSON = "zitadel.json";

/**
 * The branding meta-schema's path.
 */
const BRANDING = ".zitadel/meta/branding.json";

/**
 * A meta-schema from an older dialect than this CLI's.
 */
const OUTDATED_BRANDING = '{"title": "an older dialect"}\n';

/**
 * The React app setup scaffolds into before patching.
 */
const REACT_APP: Record<string, string> = {
  "package.json": JSON.stringify({ name: "demo", dependencies: { vite: "^7.0.0" } }),
  "vite.config.ts": "export default {}\n",
  "index.html":
    '<!doctype html>\n<html>\n  <body>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n',
  "src/main.tsx":
    "import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\n" +
    "import App from './App.tsx'\n\n" +
    "createRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)\n",
};

/**
 * What the integration is applied with: a React app on a local issuer, for a
 * project with one preview origin.
 *
 * @param overrides - What the test is about.
 * @returns The context.
 */
function aContext(overrides: Partial<PatchContext> = {}): PatchContext {
  return {
    framework: { id: "react", appDir: "src", devPort: 3000, url: "http://localhost:3000" },
    rendererId: "react",
    project: {
      id: "proj-1",
      project_secret: "sk_full",
      preview_secret: "sk_preview",
      origins: [{ kind: "preview", pattern: "https://*.example.vercel.app" }],
      created_at: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:3000",
    server: "http://localhost:8080",
    cliVersion: CLI_VERSION,
    ...overrides,
  };
}

/**
 * A rule patcher. The base ops are shared by every rule patcher, so React
 * stands in for them all.
 *
 * @returns The patcher.
 */
function aRulePatcher(): ReactPatcher {
  return new ReactPatcher();
}

/**
 * The JSON a plan writes at `path`.
 *
 * @param plan - The plan.
 * @param path - The file, from the project root.
 * @returns The parsed contents, or undefined when the plan does not write it.
 */
function writtenJson(plan: ScaffoldPlan, path: string): unknown {
  for (const op of plan.ops) {
    if (op.kind === "write" && op.path === path) {
      return JSON.parse(op.contents);
    }
  }
  return undefined;
}

/**
 * The meta-schema a document's `$schema` names, among those setup writes.
 *
 * @param document - The document.
 * @returns The meta-schema, or undefined when it names none of them.
 */
function metaSchemaNamedBy(document: unknown): ProjectMetaSchema | undefined {
  if (typeof document !== "object" || document === null || !("$schema" in document)) {
    return undefined;
  }
  const ref = document.$schema;
  if (typeof ref !== "string") {
    return undefined;
  }
  return projectMetaSchemas(CLI_VERSION).find((file) => {
    return file.path === posix.normalize(ref);
  });
}

/**
 * What the meta-schema a document names says is wrong with it.
 *
 * @param document - The document.
 * @returns Each validation error; none when the meta-schema accepts it.
 */
function metaSchemaErrors(document: unknown): unknown[] {
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(
    metaSchemaNamedBy(document)?.body ?? {},
  );
  validate(document);
  return validate.errors ?? [];
}

/**
 * This CLI's contents for one meta-schema.
 *
 * @param path - The meta-schema's path.
 * @returns Its contents, or undefined when this CLI ships none there.
 */
function metaSchemaContents(path: string): string | undefined {
  return projectMetaSchemas(CLI_VERSION).find((file) => {
    return file.path === path;
  })?.contents;
}

describe("AbstractRulePatcher.plan", () => {
  it("writes the server's address to .env.local, which the app reads", () => {
    const env = aRulePatcher()
      .plan(aContext())
      .ops.filter(
        (op): op is Extract<FileOp, { kind: "merge-env" }> =>
          op.kind === "merge-env" && op.path === ".env.local",
      );

    expect(env.map((op) => op.entries.ZITADEL_URL)).toContain("http://localhost:8080");
  });

  describe("with a preset and a use case", () => {
    const context = aContext({ preset: "passkey-first", useCase: "consumer" });

    it("points zitadel.json's $schema at a path rather than a URL", () => {
      const plan = aRulePatcher().plan(context);

      expect(writtenJson(plan, ZITADEL_JSON)).toMatchObject({
        $schema: expect.stringMatching(/^(?!https?:)/),
      });
    });

    it("points zitadel.json's $schema at a meta-schema setup writes", () => {
      const plan = aRulePatcher().plan(context);

      expect(metaSchemaNamedBy(writtenJson(plan, ZITADEL_JSON))).toBeDefined();
    });

    it("writes a zitadel.json the meta-schema it names accepts", () => {
      const plan = aRulePatcher().plan(context);

      expect(metaSchemaErrors(writtenJson(plan, ZITADEL_JSON))).toEqual([]);
    });
  });
});

describe("AbstractRulePatcher.patch", () => {
  it("writes this CLI's meta-schemas and reports each one", async ({ dir }) => {
    await write(dir, REACT_APP);
    const expected = projectMetaSchemas(CLI_VERSION).map((file) => {
      return join(dir, file.path);
    });

    const result = await aRulePatcher().patch(aContext(), {
      cwd: dir,
      dryRun: false,
      force: false,
    });

    expect(result.filesWritten).toEqual(expect.arrayContaining(expected));
  });

  describe("with an outdated meta-schema", () => {
    it("replaces it without --force", async ({ dir }) => {
      await write(dir, { ...REACT_APP, [BRANDING]: OUTDATED_BRANDING });

      await aRulePatcher().patch(aContext(), { cwd: dir, dryRun: false, force: false });

      expect(await readFile(join(dir, BRANDING), "utf8")).toBe(metaSchemaContents(BRANDING));
    });
  });
});
