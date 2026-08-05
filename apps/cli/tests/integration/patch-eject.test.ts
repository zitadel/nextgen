import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetPlatformStore, setupPlatformHandlers } from "@zitadel/api-mock/platform";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../helpers/run-cli";

const MOCK_SERVER_URL = "http://mock.zitadel.test";
const MANAGED_MARKER = "zitadel-cli: managed-file v1";

const server = setupServer(...setupPlatformHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  resetPlatformStore();
});

function cli(args: string[]) {
  return runCliForTest([...args, "--server", MOCK_SERVER_URL]);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("patch then eject round-trip", () => {
  it("patches a Next project, then ejects the managed files it created", async () => {
    const cwd = await createNextProject();
    // A pre-existing README proves eject strips only the managed guidance
    // section; AGENTS.md (created wholesale by setup) must vanish entirely.
    await writeFile(join(cwd, "README.md"), "# demo-next-app\n\nDeploy notes.\n");

    const setup = await cli([
      "setup",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
      "--skip-install",
    ]);
    expect(setup.exitCode).toBe(0);
    expect((parseJson(setup.stdout) as { status: string }).status).toBe("ok");

    // Patch wrote the managed tree + framework routes.
    expect((await stat(join(cwd, ".zitadel/secret"))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(cwd, "zitadel.json"), "utf8")).toContain('"project"');
    expect(await readFile(join(cwd, "app/login/page.tsx"), "utf8")).toContain(MANAGED_MARKER);
    expect(await readFile(join(cwd, "middleware.ts"), "utf8")).toContain(MANAGED_MARKER);
    expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toContain("zitadel:guidance:begin");
    expect(await readFile(join(cwd, "README.md"), "utf8")).toContain(
      "## Authentication (Zitadel)",
    );

    // Simulate the user replacing the register page with their own (unmarked) file.
    await writeFile(
      join(cwd, "app/register/page.tsx"),
      "export default function Page() { return null; }\n",
    );

    const eject = await cli(["eject", "--cwd", cwd, "--force", "--json"]);
    expect(eject.exitCode).toBe(0);
    const ejectJson = parseJson(eject.stdout) as {
      status: string;
      data: { files_removed: string[]; files_preserved: string[]; backed_up: string[] };
    };
    expect(ejectJson.status).toBe("ok");
    expect(ejectJson.data.files_removed).toContain("app/login/page.tsx");
    expect(ejectJson.data.files_removed).toContain("middleware.ts");
    expect(ejectJson.data.files_removed).toContain("zitadel.json");
    expect(ejectJson.data.files_removed).toContain(".zitadel");
    expect(ejectJson.data.files_preserved).toContain("app/register/page.tsx");
    expect(ejectJson.data.backed_up.join(" ")).toContain(".env.local");

    // The marked files and managed tree are gone; the user-owned page survives.
    expect(await exists(join(cwd, ".zitadel"))).toBe(false);
    expect(await exists(join(cwd, "zitadel.json"))).toBe(false);
    expect(await exists(join(cwd, "app/login/page.tsx"))).toBe(false);
    expect(await exists(join(cwd, "middleware.ts"))).toBe(false);
    expect(await exists(join(cwd, "app/register/page.tsx"))).toBe(true);
    expect(await exists(join(cwd, ".env.local"))).toBe(false);

    // Guidance follows the integration out: the scaffold-created AGENTS.md is
    // gone, and the user's README keeps everything but the managed section.
    expect(ejectJson.data.files_removed).toContain("AGENTS.md");
    expect(ejectJson.data.files_removed).toContain("README.md (managed section)");
    expect(await exists(join(cwd, "AGENTS.md"))).toBe(false);
    const readmeAfter = await readFile(join(cwd, "README.md"), "utf8");
    expect(readmeAfter).toContain("Deploy notes.");
    expect(readmeAfter).not.toContain("zitadel:guidance");
    expect(readmeAfter).not.toContain("## Authentication (Zitadel)");
  });
});

async function createNextProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-patch-eject-"));
  await mkdir(join(cwd, "app"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "demo-next-app",
        private: true,
        dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      null,
      2,
    ),
  );
  await writeFile(join(cwd, ".gitignore"), "node_modules\n");
  await writeFile(
    join(cwd, "app/layout.tsx"),
    "export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n",
  );
  return cwd;
}
