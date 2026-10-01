import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import { QwikScaffolder } from "../../../../../src/lib/orca/scaffolders/qwik";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({ rm: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() }));
const mockSpawn = vi.mocked(spawnSync);
const mockRm = vi.mocked(rm);
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);

function spawnOk(): ReturnType<typeof spawnSync> {
  return { status: 0, stderr: "", stdout: "", pid: 1, output: [], signal: null } as ReturnType<
    typeof spawnSync
  >;
}

// What create-vite's `qwik-ts` template emits today: Qwik 1 in `dependencies`
// with Vite 8, and Qwik imports in vite.config.ts / src/main.tsx.
const TEMPLATE_FILES: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "vite-qwik",
    dependencies: { "@builder.io/qwik": "^1.20.1" },
    devDependencies: { vite: "^8.3.1", typescript: "~6.0.2" },
  }),
  "vite.config.ts": `import { qwikVite } from '@builder.io/qwik/optimizer'\nimport { defineConfig } from 'vite'\n`,
  "src/main.tsx": `import '@builder.io/qwik/qwikloader.js'\nimport { render } from '@builder.io/qwik'\n`,
  "tsconfig.app.json": `{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@builder.io/qwik" } }\n`,
};

function fileFor(path: string): string | undefined {
  return Object.entries(TEMPLATE_FILES).find(([name]) => path.endsWith(name))?.[1];
}

function writtenFor(name: string): string | undefined {
  const call = mockWriteFile.mock.calls.find(([path]) => String(path).endsWith(name));
  return call ? String(call[1]) : undefined;
}

beforeEach(() => {
  mockSpawn.mockReset();
  mockRm.mockReset();
  mockReadFile.mockReset();
  mockWriteFile.mockReset();
  mockSpawn.mockReturnValue(spawnOk());
  mockRm.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockReadFile.mockImplementation((path: Parameters<typeof readFile>[0]) => {
    const contents = fileFor(String(path));
    return contents === undefined
      ? Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
      : Promise.resolve(contents);
  });
});

describe("QwikScaffolder", () => {
  it("runs create-vite and removes the starter demo", async () => {
    await new QwikScaffolder().scaffold("/tmp/proj", "qwik");

    const [command, args, opts] = mockSpawn.mock.calls[0] ?? [];
    expect(command).toBe("npm");
    expect(args).toEqual(["create", "vite@latest", ".", "--", "--template", "qwik-ts"]);
    expect(opts).toMatchObject({ cwd: "/tmp/proj" });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/app.tsx"), { force: true });
    expect(mockRm).toHaveBeenCalledWith(join("/tmp/proj", "src/app.css"), { force: true });
  });

  it("migrates the generated app to Qwik 2 and never pins vite to v7", async () => {
    await new QwikScaffolder().scaffold("/tmp/proj", "qwik");

    // No `npm pkg` vite pin — Qwik 2 runs on the template's Vite 8.
    for (const call of mockSpawn.mock.calls) {
      expect(call[1]).not.toContain("pkg");
    }
    const pkg = JSON.parse(writtenFor("package.json") ?? "{}") as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@builder.io/qwik"]).toBeUndefined();
    expect(pkg.dependencies?.["@qwik.dev/core"]).toBe("^2.0.0-beta.45");
    // The template's Vite 8 is left untouched (no downgrade).
    expect(pkg.devDependencies?.vite).toBe("^8.3.1");
  });

  it("repoints the generated Qwik imports at @qwik.dev/core", async () => {
    await new QwikScaffolder().scaffold("/tmp/proj", "qwik");

    const viteConfig = writtenFor("vite.config.ts");
    const mainTsx = writtenFor("src/main.tsx");
    const tsconfigApp = writtenFor("tsconfig.app.json");
    expect(viteConfig).toContain("@qwik.dev/core/optimizer");
    expect(viteConfig).not.toContain("@builder.io/qwik");
    expect(mainTsx).toContain("@qwik.dev/core/qwikloader.js");
    expect(mainTsx).toContain("from '@qwik.dev/core'");
    expect(mainTsx).not.toContain("@builder.io/qwik");
    // jsxImportSource must move too, or `tsc -b && vite build` breaks.
    expect(tsconfigApp).toContain('"jsxImportSource": "@qwik.dev/core"');
    expect(tsconfigApp).not.toContain("@builder.io/qwik");
  });

  it("only supports qwik", () => {
    const scaffolder = new QwikScaffolder();
    expect(scaffolder.canScaffold("qwik")).toBe(true);
    expect(scaffolder.canScaffold("react")).toBe(false);
  });
});
