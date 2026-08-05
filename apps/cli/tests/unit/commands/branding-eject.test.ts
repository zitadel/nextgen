import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getDefaultBrandingConfig } from "@zitadel/config/defaults";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

const tempDirs: string[] = [];

async function makeProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-branding-eject-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(join(cwd, "zitadel.json"), `${JSON.stringify({ version: "0.0.1" })}\n`);
  return cwd;
}

function eject(cwd: string, ...extra: string[]) {
  // --json implies non-interactive, so the design prompt never fires in tests.
  return runCliForTest(["branding", "eject", "--cwd", cwd, "--json", ...extra]);
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("branding eject", () => {
  it("scaffolds descriptor, template, README, and the dialect meta-schema", async () => {
    const cwd = await makeProject();

    const res = await eject(cwd);
    expect(res.exitCode, res.stderr).toBe(0);
    const envelope = parseJson(res.stdout) as {
      status: string;
      data: { design: string; files_written: string[]; next_commands: string[] };
    };
    expect(envelope.status).toBe("ok");
    expect(envelope.data.design).toBe("centered");
    expect(envelope.data.files_written).toEqual(
      expect.arrayContaining([
        ".zitadel/branding/branding.json",
        ".zitadel/branding/login.liquid",
        ".zitadel/branding/README.md",
        ".zitadel/meta/branding.json",
      ]),
    );

    const descriptor = JSON.parse(
      await readFile(join(cwd, ".zitadel/branding/branding.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(descriptor.$schema).toBe("../meta/branding.json");
    expect(descriptor.layout).toBe("centered");
    expect(descriptor.liquid_template_file).toBe("./login.liquid");

    const template = await readFile(join(cwd, ".zitadel/branding/login.liquid"), "utf8");
    expect(template).toBe(getDefaultBrandingConfig("centered").template);
  });

  it("--design split writes the split template and layout", async () => {
    const cwd = await makeProject();

    const res = await eject(cwd, "--design", "split");
    expect(res.exitCode, res.stderr).toBe(0);

    const descriptor = JSON.parse(
      await readFile(join(cwd, ".zitadel/branding/branding.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(descriptor.layout).toBe("split");

    const template = await readFile(join(cwd, ".zitadel/branding/login.liquid"), "utf8");
    expect(template).toBe(getDefaultBrandingConfig("split").template);
    expect(template).toContain('class="zl-split"');
  });

  it("refuses to overwrite existing files without --force", async () => {
    const cwd = await makeProject();
    await eject(cwd);

    const res = await eject(cwd);
    expect(res.exitCode).not.toBe(0);
    expect(res.stdout + res.stderr).toContain("E_CONFLICT");
  });

  it("--force replaces the scaffolded files with the chosen design", async () => {
    const cwd = await makeProject();
    await eject(cwd);

    const res = await eject(cwd, "--design", "minimal", "--force");
    expect(res.exitCode, res.stderr).toBe(0);

    const template = await readFile(join(cwd, ".zitadel/branding/login.liquid"), "utf8");
    expect(template).toBe(getDefaultBrandingConfig("minimal").template);
  });

  it("fails with a setup hint outside a Zitadel project", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-branding-eject-bare-"));
    tempDirs.push(cwd);

    const res = await eject(cwd);
    expect(res.exitCode).not.toBe(0);
    expect(res.stdout + res.stderr).toContain("not a Zitadel project");
  });
});
