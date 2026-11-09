import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getDefaultBrandingConfig } from "@zitadel/config/defaults";

import BrandingEject from "@/commands/branding/eject";
import { projectMetaSchemas } from "@/lib/meta-schemas";
import { cliVersion, parseJson, runCliForTest } from "@tests/helpers/run-cli";
import { asTerminalTyping } from "@tests/helpers/terminal";

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
    expect(descriptor.liquid_template).toEqual({ $file: "./login.liquid" });

    const template = await readFile(join(cwd, ".zitadel/branding/login.liquid"), "utf8");
    expect(template).toBe(getDefaultBrandingConfig("centered").template);

    // The README's command mentions must be runnable: the scaffolded app has
    // no `zitadel` binary, so prose is normalized to the public npx form.
    const readme = await readFile(join(cwd, ".zitadel/branding/README.md"), "utf8");
    expect(readme).toContain("npx @zitadel/cli@");
    expect(readme).not.toMatch(/`zitadel /);

    // Same rule for the dialect file: its `description` strings are the
    // editor tooltip on branding.json, so a bare `zitadel apply` there reads
    // as a command the generated app doesn't have.
    const meta = await readFile(join(cwd, ".zitadel/meta/branding.json"), "utf8");
    expect(meta).toContain("npx @zitadel/cli@");
    expect(meta).not.toMatch(/`zitadel /);
  });

  it("writes the dialect meta-schema byte for byte as setup does", async () => {
    const cwd = await makeProject();

    await eject(cwd);

    const expected = projectMetaSchemas(cliVersion.version).find(
      (file) => file.path === ".zitadel/meta/branding.json",
    );
    const meta = await readFile(join(cwd, ".zitadel/meta/branding.json"), "utf8");
    expect(meta).toBe(expected?.contents);
  });

  it("replaces an outdated dialect meta-schema with this version's", async () => {
    const cwd = await makeProject();
    await mkdir(join(cwd, ".zitadel/meta"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/meta/branding.json"), '{"title": "an older dialect"}\n');

    const res = await eject(cwd);

    expect(res.exitCode, res.stderr).toBe(0);
    const expected = projectMetaSchemas(cliVersion.version).find(
      (file) => file.path === ".zitadel/meta/branding.json",
    );
    const meta = await readFile(join(cwd, ".zitadel/meta/branding.json"), "utf8");
    expect(meta).toBe(expected?.contents);
  });

  it("writes nothing through a dialect meta-schema that is a symlink", async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, ".zitadel/secret"), '{"project_secret": "sk_proj_test"}\n');
    await mkdir(join(cwd, ".zitadel/meta"), { recursive: true });
    await symlink("../secret", join(cwd, ".zitadel/meta/branding.json"));

    const res = await eject(cwd);

    expect(res.exitCode, res.stderr).toBe(0);
    expect(await readFile(join(cwd, ".zitadel/secret"), "utf8")).toBe(
      '{"project_secret": "sk_proj_test"}\n',
    );
    expect((await lstat(join(cwd, ".zitadel/meta/branding.json"))).isSymbolicLink()).toBe(true);
  });

  it("--design minimal writes the card-less template on the centered layout", async () => {
    const cwd = await makeProject();

    const res = await eject(cwd, "--design", "minimal");
    expect(res.exitCode, res.stderr).toBe(0);

    const descriptor = JSON.parse(
      await readFile(join(cwd, ".zitadel/branding/branding.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(descriptor.layout).toBe("centered");

    const template = await readFile(join(cwd, ".zitadel/branding/login.liquid"), "utf8");
    expect(template).toBe(getDefaultBrandingConfig("minimal").template);
    expect(template).not.toContain("<zl-card");
  });

  it("refuses page-layout designs with a pointer to the app (#1039)", async () => {
    // split, split-right and hero were page chrome around the default card;
    // that layout belongs in the embedding app, not the widget template.
    for (const design of ["split", "split-right", "hero"]) {
      const cwd = await makeProject();
      const res = await eject(cwd, "--design", design);
      expect(res.exitCode, design).toBe(3);
      const json = parseJson(res.stdout) as {
        code: string;
        message: string;
        hint: string;
        next_commands: string[];
      };
      expect(json.code, design).toBe("E_VALIDATION");
      expect(json.message, design).toContain(`The ${design} design was retired`);
      expect(json.hint, design).toContain("<zitadel-login>");
      expect(json.hint, design).toContain("centered, minimal");
      expect(json.next_commands, design).toEqual([
        expect.stringContaining("branding eject --design centered"),
      ]);
      await expect(readFile(join(cwd, ".zitadel/branding/login.liquid"), "utf8")).rejects.toThrow();
    }
  });

  it("quotes an unknown design as JSON, so an escape sequence in it cannot drive the terminal", async () => {
    const cwd = await makeProject();

    const res = await eject(cwd, "--design", "x\u001b[31m");

    const json = parseJson(res.stdout) as { message: string };
    expect(json.message).toBe('Unknown design "x\\u001b[31m"');
  });

  it("rejects an unknown design and lists the catalog", async () => {
    const cwd = await makeProject();
    const res = await eject(cwd, "--design", "nope");
    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { code: string; message: string; hint: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain('"nope"');
    expect(json.hint).toBe("Pick one of: centered, minimal.");
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

describe("branding eject asked on a terminal", () => {
  // The built CLI bundles its own prompts, so a prompt can only be answered
  // by running the command from source, where `input` is the one module asked.
  const ejecting = (cwd: string, ...answers: string[]) =>
    asTerminalTyping(answers, () => BrandingEject.run(["--cwd", cwd]));

  it("asks plainly, numbering the designs and taking the answer on the same line", async () => {
    const cwd = await makeProject();

    const { shown } = await ejecting(cwd, "2");

    expect(shown).toMatch(
      /^Which design would you like to start from\?\n {2}1\) {2}Default card.*\n {2}2\) {2}Minimal.*\n\[1-2\] \(1\) /,
    );
  });

  it("scaffolds the design that was chosen", async () => {
    const cwd = await makeProject();

    await ejecting(cwd, "2");

    expect(await readFile(join(cwd, ".zitadel/branding/login.liquid"), "utf8")).toBe(
      getDefaultBrandingConfig("minimal").template,
    );
  });

  it("scaffolds the default design when the answer is empty", async () => {
    const cwd = await makeProject();

    await ejecting(cwd, "");

    expect(await readFile(join(cwd, ".zitadel/branding/login.liquid"), "utf8")).toBe(
      getDefaultBrandingConfig("centered").template,
    );
  });

  it("fails, scaffolding nothing, when the person walks away", async () => {
    const cwd = await makeProject();

    await expect(ejecting(cwd)).rejects.toThrow();

    await expect(readFile(join(cwd, ".zitadel/branding/branding.json"), "utf8")).rejects.toThrow();
  });
});
