import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../helpers/run-cli";

async function scaffoldProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-locale-"));
  await mkdir(join(cwd, "app"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "demo", private: true, dependencies: { next: "^15" } }, null, 2),
  );
  await writeFile(
    join(cwd, "app/layout.tsx"),
    "export default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n",
  );
  const setup = await runCliForTest([
    "setup",
    "--cwd",
    cwd,
    "--non-interactive",
    "--json",
    "--mock",
    "--skip-deploy-platform",
    "--no-apply",
  ]);
  if (setup.exitCode !== 0) throw new Error(`setup failed: ${setup.stdout}`);
  return cwd;
}

describe("locale tooling", () => {
  it("setup seeds .zitadel/locales/en.json with populated core keys", async () => {
    const cwd = await scaffoldProject();
    const raw = JSON.parse(await readFile(join(cwd, ".zitadel/locales/en.json"), "utf8")) as Record<string, string>;
    expect(raw["identifier.title"]).toBe("Sign in");
    expect(raw["identifier.action.submit"]).toBe("Continue");
    expect(raw["register_profile.action.submit"]).toBe("Create account");
  });

  it("locale scaffold is idempotent and adds missing keys", async () => {
    const cwd = await scaffoldProject();

    // First run should be a no-op
    const first = await runCliForTest(["locale", "scaffold", "--cwd", cwd, "--json"]);
    expect(first.exitCode).toBe(0);
    const firstEnv = parseJson(first.stdout) as { status: string; data: { changed: boolean; added_keys: string[] } };
    expect(firstEnv.status).toBe("ok");
    expect(firstEnv.data.changed).toBe(false);
    expect(firstEnv.data.added_keys).toEqual([]);

    // Corrupt en.json (drop a known key) and re-run
    const path = join(cwd, ".zitadel/locales/en.json");
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, string>;
    delete raw["identifier.title"];
    await writeFile(path, JSON.stringify(raw, null, 2) + "\n");

    const second = await runCliForTest(["locale", "scaffold", "--cwd", cwd, "--json"]);
    expect(second.exitCode).toBe(0);
    const secondEnv = parseJson(second.stdout) as { data: { changed: boolean; added_keys: string[] } };
    expect(secondEnv.data.changed).toBe(true);
    expect(secondEnv.data.added_keys).toContain("identifier.title");

    // Added keys should be empty strings, existing values preserved
    const updated = JSON.parse(await readFile(path, "utf8")) as Record<string, string>;
    expect(updated["identifier.title"]).toBe("");
    expect(updated["identifier.action.submit"]).toBe("Continue");
  });

  it("locale scaffold --lang de creates a new locale with empty values", async () => {
    const cwd = await scaffoldProject();
    const result = await runCliForTest(["locale", "scaffold", "--cwd", cwd, "--json", "--lang", "de"]);
    expect(result.exitCode).toBe(0);
    const raw = JSON.parse(await readFile(join(cwd, ".zitadel/locales/de.json"), "utf8")) as Record<string, string>;
    expect(raw["identifier.title"]).toBe("");
    expect(raw["register_profile.action.submit"]).toBe("");
  });

  it("locale list returns all locale files with key counts", async () => {
    const cwd = await scaffoldProject();
    await runCliForTest(["locale", "scaffold", "--cwd", cwd, "--json", "--lang", "de"]);
    const list = await runCliForTest(["locale", "list", "--cwd", cwd, "--json"]);
    expect(list.exitCode).toBe(0);
    const env = parseJson(list.stdout) as { data: { locales: Array<{ lang: string; key_count: number }> } };
    expect(env.data.locales.map((l) => l.lang)).toEqual(expect.arrayContaining(["en", "de"]));
    const en = env.data.locales.find((l) => l.lang === "en");
    expect(en?.key_count).toBeGreaterThan(0);
  });
});
