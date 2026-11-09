import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import { afterEach, describe, expect, it } from "vitest";

import { projectMetaSchemas } from "@/lib/meta-schemas";
import type { FileOp, ScaffoldPlan } from "@/lib/orca/patchers/rule/file-writer/types";
import { ReactPatcher } from "@/lib/orca/patchers/rule/react";
import type { PatchContext } from "@/lib/orca/patchers/types";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => {
      return rm(dir, { recursive: true, force: true });
    }),
  );
});

function ctx(overrides: Partial<PatchContext> = {}): PatchContext {
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
    cliVersion: "0.1.0-alpha.0",
    ...overrides,
  };
}

function written(plan: ScaffoldPlan, path: string): Record<string, unknown> {
  const op = plan.ops.find(
    (candidate): candidate is Extract<FileOp, { kind: "write" }> =>
      candidate.kind === "write" && candidate.path === path,
  );
  expect(op, `${path} is written`).toBeDefined();
  return JSON.parse(op?.contents ?? "") as Record<string, unknown>;
}

/**
 * The React app setup scaffolds before patching, in a new directory removed
 * after the test, holding `extra` besides.
 *
 * @param extra - More files, by their path from the root.
 * @returns The app's root.
 */
async function aReactApp(extra: Record<string, string> = {}): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-base-"));
  dirs.push(cwd);
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "demo", dependencies: { vite: "^7.0.0" } }),
    "vite.config.ts": "export default {}\n",
    "index.html": '<!doctype html>\n<html>\n  <body>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n',
    "src/main.tsx":
      "import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\n" +
      "import App from './App.tsx'\n\n" +
      "createRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)\n",
    ...extra,
  };
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), contents);
  }
  return cwd;
}

// The base ops are shared by every rule patcher; React stands in for them.
describe("zitadel.json", () => {
  it("points $schema at a meta-schema setup writes, which accepts the file", () => {
    const plan = new ReactPatcher().plan(ctx({ preset: "passkey-first", useCase: "consumer" }));
    const config = written(plan, "zitadel.json");

    const ref = config.$schema as string;
    expect(ref).not.toMatch(/^https?:/);
    const schema = projectMetaSchemas(ctx().cliVersion).find((file) => {
      return file.path === posix.normalize(ref);
    });
    expect(schema, `${ref} is a meta-schema`).toBeDefined();

    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(
      schema?.body ?? {},
    );
    expect(validate(config), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe("patch", () => {
  it("writes this CLI's meta-schemas and reports each one", async () => {
    const cwd = await aReactApp();
    const files = projectMetaSchemas(ctx().cliVersion);

    const result = await new ReactPatcher().patch(ctx(), { cwd, dryRun: false, force: false });

    expect(result.filesWritten).toEqual(
      expect.arrayContaining(
        files.map((file) => {
          return join(cwd, file.path);
        }),
      ),
    );
  });

  it("replaces an outdated meta-schema without --force", async () => {
    const cwd = await aReactApp({ ".zitadel/meta/branding.json": '{"title": "an older dialect"}\n' });
    const branding = projectMetaSchemas(ctx().cliVersion).find((file) => {
      return file.path === ".zitadel/meta/branding.json";
    });

    await new ReactPatcher().patch(ctx(), { cwd, dryRun: false, force: false });

    expect(await readFile(join(cwd, ".zitadel/meta/branding.json"), "utf8")).toBe(
      branding?.contents,
    );
  });
});
