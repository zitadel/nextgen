import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import Eject from "@/cli/commands/eject";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";
import { type Answer, answering } from "@tests/helpers/keyboard";
import { asTerminal } from "@tests/helpers/terminal";
import { MANAGED_MARKER } from "@/lib/paths";
import { stripAnsi } from "@tests/helpers/run-cli";

function eject(cwd: string, extra: string[] = []) {
  return runCliForTest([
    "eject",
    "--cwd",
    cwd,
    "--json",
    "--server",
    "https://api.zitadel.cloud",
    ...extra,
  ]);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const tempDirs: string[] = [];

/**
 * Builds a managed project with the full set of files eject is expected to
 * touch: config/state/secret/schemas, a managed login page (with marker), an
 * unmanaged register page (no marker), and a .env.local.
 */
async function makeManagedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-eject-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
  await mkdir(join(cwd, "app/login"), { recursive: true });
  await mkdir(join(cwd, "app/register"), { recursive: true });

  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
  );
  await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ project: "proj-001" }));
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify({ project_id: "proj-001" }));
  await writeFile(join(cwd, ".zitadel/state.json"), JSON.stringify({ framework: "next" }));
  await writeFile(join(cwd, ".zitadel/schemas/user.json"), JSON.stringify({ type: "object" }));
  await writeFile(join(cwd, ".zitadel/flows/default.json"), JSON.stringify({ name: "default" }));
  await writeFile(
    join(cwd, "app/login/page.tsx"),
    `${MANAGED_MARKER}\nexport default function L() {}\n`,
  );
  // Register page lacks the managed marker, so eject must preserve it.
  await writeFile(join(cwd, "app/register/page.tsx"), "export default function R() {}\n");
  await writeFile(join(cwd, ".env.local"), "ZITADEL_PROJECT_ID=proj-001\n");
  return cwd;
}

/**
 * Builds a managed Vue (Vite) project — the patcher merges its dev proxy into
 * `vite.config.ts` via an `edit`, which eject can't reverse, so it must surface
 * the file as a manual cleanup step rather than deleting it.
 */
async function makeManagedViteProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-eject-vite-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { vue: "^3" }, devDependencies: { vite: "^5" } }),
  );
  await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ project: "proj-001" }));
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify({ project_id: "proj-001" }));
  await writeFile(join(cwd, "src/App.vue"), `<!-- ${MANAGED_MARKER} -->\n<template></template>\n`);
  await writeFile(join(cwd, "vite.config.ts"), "export default {};\n");
  return cwd;
}

/**
 * A Nuxt 4 app as an older setup left it: the two plugins setup used to write
 * (one still managed, one the user took over) beside a managed page.
 */
async function makeOlderNuxtProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-eject-nuxt-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await mkdir(join(cwd, "app/pages"), { recursive: true });
  await mkdir(join(cwd, "app/plugins"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "demo",
      dependencies: { nuxt: "^4.1.0", "@zitadel/sdk-nuxt": "latest" },
    }),
  );
  await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ project: "proj-001" }));
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify({ project_id: "proj-001" }));
  await writeFile(join(cwd, "nuxt.config.ts"), "export default defineNuxtConfig({});\n");
  await writeFile(
    join(cwd, "app/pages/login.vue"),
    `<script setup>\n// ${MANAGED_MARKER}\n</script>\n`,
  );
  await writeFile(
    join(cwd, "app/plugins/zitadel-components.client.ts"),
    `// ${MANAGED_MARKER}\nimport "@zitadel/components";\n`,
  );
  await writeFile(
    join(cwd, "app/plugins/auth.server.ts"),
    "export default defineNuxtPlugin(() => {});\n",
  );
  return cwd;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("eject command", () => {
  it("refuses to run without --force in non-interactive mode", async () => {
    const cwd = await makeManagedProject();

    const res = await eject(cwd);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { status: string; code: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_CONFIRMATION_REQUIRED");
    // Nothing should have been removed.
    expect(await exists(join(cwd, "zitadel.json"))).toBe(true);
    expect(await exists(join(cwd, ".zitadel"))).toBe(true);
  });

  it("removes managed files and the .zitadel dir when forced", async () => {
    const cwd = await makeManagedProject();

    const res = await eject(cwd, ["--force"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: {
        files_removed: string[];
        files_preserved: string[];
        backed_up: string[];
        next_commands: string[];
      };
    };
    expect(json.status).toBe("ok");
    // The CLI doesn't touch package.json (lockfile + other deps), but suggests
    // the user uninstall the SDK package the patcher added.
    // Run in the ejected project, which is --cwd and not the shell's directory.
    expect(json.data.next_commands).toContain(`cd ${cwd} && npm uninstall @zitadel/sdk-next`);

    // Managed files and config/state are gone.
    expect(json.data.files_removed).toContain("zitadel.json");
    expect(json.data.files_removed).toContain("app/login/page.tsx");
    expect(await exists(join(cwd, "zitadel.json"))).toBe(false);
    expect(await exists(join(cwd, "app/login/page.tsx"))).toBe(false);
    // The whole .zitadel directory is removed wholesale.
    expect(await exists(join(cwd, ".zitadel"))).toBe(false);

    // The unmanaged register page is preserved.
    expect(json.data.files_preserved).toContain("app/register/page.tsx");
    expect(await exists(join(cwd, "app/register/page.tsx"))).toBe(true);

    // .env.local is renamed to a timestamped backup, not deleted.
    expect(json.data.backed_up.length).toBe(1);
    expect(await exists(join(cwd, ".env.local"))).toBe(false);
    const entries = await readdir(cwd);
    expect(entries.some((name) => name.startsWith(".env.local.ejected-"))).toBe(true);
  });

  // One sentence, in the past tense, with no full stop: the chain closes on
  // it, and "Zitadel ejected, and the remote project is untouched." was two.
  it("closes on one sentence saying what it did", async () => {
    const cwd = await makeManagedProject();

    const res = await eject(cwd, ["--force"]);

    expect((parseJson(res.stdout) as { data: { title: string } }).data.title).toBe(
      "Removed Zitadel from this app, leaving the remote project untouched",
    );
  });

  it("answers a dry run as one, saying what it would do", async () => {
    const cwd = await makeManagedProject();

    const res = await eject(cwd, ["--dry-run"]);

    expect(parseJson(res.stdout)).toMatchObject({
      status: "ok",
      data: {
        dry_run: true,
        title: "Would remove Zitadel from this app, leaving the remote project untouched (dry run)",
        next_commands: [expect.stringContaining("eject --force")],
      },
    });
  });

  it("reports what would be removed in dry-run without touching the filesystem", async () => {
    const cwd = await makeManagedProject();

    const res = await eject(cwd, ["--force", "--dry-run"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      data: { files_removed: string[]; backed_up: string[] };
    };
    expect(json.data.files_removed).toContain("zitadel.json");
    // Dry-run must still preview the .env.local backup, not silently omit it.
    expect(json.data.backed_up.some((entry) => entry.startsWith(".env.local"))).toBe(true);

    // Dry-run leaves everything in place.
    expect(await exists(join(cwd, "zitadel.json"))).toBe(true);
    expect(await exists(join(cwd, ".zitadel"))).toBe(true);
    expect(await exists(join(cwd, ".env.local"))).toBe(true);
  });

  it("strips guidance sections and deletes scaffold-created husks", async () => {
    const cwd = await makeManagedProject();
    const begin = "<!-- zitadel:guidance:begin -->";
    const end = "<!-- zitadel:guidance:end -->";
    // Scaffold-created AGENTS.md: nothing but the header around the managed
    // section, so eject removes the whole file.
    await writeFile(
      join(cwd, "AGENTS.md"),
      `# AGENTS.md\n\nGuidance for AI agents working in this repository.\n\n${begin}\n## Authentication (Zitadel)\nstale golden path\n${end}\n`,
    );
    // README.md carries real user content around the managed section, so only
    // the section goes.
    await writeFile(
      join(cwd, "README.md"),
      `# demo\n\nMy notes.\n\n${begin}\n## Authentication (Zitadel)\nstale golden path\n${end}\n`,
    );

    // Dry-run previews the removals without touching either file.
    const preview = await eject(cwd, ["--force", "--dry-run"]);
    expect(preview.exitCode).toBe(0);
    const previewJson = parseJson(preview.stdout) as { data: { files_removed: string[] } };
    expect(previewJson.data.files_removed).toContain("AGENTS.md");
    expect(previewJson.data.files_removed).toContain("README.md (managed section)");
    expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toContain("stale golden path");

    const res = await eject(cwd, ["--force"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: { files_removed: string[] } };
    expect(json.data.files_removed).toContain("AGENTS.md");
    expect(json.data.files_removed).toContain("README.md (managed section)");
    expect(await exists(join(cwd, "AGENTS.md"))).toBe(false);
    const readme = await readFile(join(cwd, "README.md"), "utf8");
    expect(readme).toContain("My notes.");
    expect(readme).not.toContain("zitadel:guidance");
    expect(readme).not.toContain("Authentication (Zitadel)");
  });

  it("surfaces in-place config edits as manual steps for edit-based frameworks", async () => {
    const cwd = await makeManagedViteProject();

    const res = await eject(cwd, ["--force"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as {
      status: string;
      data: { files_removed: string[]; manual_steps: string[] };
    };
    expect(json.status).toBe("ok");
    // The managed App.vue is removed, but vite.config.ts can't be auto-reverted.
    expect(json.data.files_removed).toContain("src/App.vue");
    expect(json.data.manual_steps).toContain(
      "Remove the Zitadel configuration block from vite.config.*",
    );
    // The edited config file itself is left in place.
    expect(await exists(join(cwd, "vite.config.ts"))).toBe(true);
  });

  it("removes the managed Nuxt plugins an older setup wrote and keeps an edited one", async () => {
    const cwd = await makeOlderNuxtProject();

    await eject(cwd, ["--force"]);

    expect(await exists(join(cwd, "app/plugins/zitadel-components.client.ts"))).toBe(false);
    expect(await exists(join(cwd, "app/plugins/auth.server.ts"))).toBe(true);
  });

  it("emits a skipped envelope when there is nothing to eject", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-eject-empty-"));
    tempDirs.push(cwd);

    const res = await eject(cwd, ["--force"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; reason: string };
    expect(json.status).toBe("skipped");
    expect(json.reason).toBe("nothing-to-eject");
  });

  it("suggests setup in the envelope when there is nothing to eject", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-eject-empty-"));
    tempDirs.push(cwd);

    const res = await eject(cwd, ["--force"]);

    expect(parseJson(res.stdout)).toMatchObject({
      next_commands: [expect.stringContaining("setup")],
    });
  });

  it("suggests setup in the envelope on a dry run with nothing to eject", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-eject-empty-"));
    tempDirs.push(cwd);

    const res = await eject(cwd, ["--dry-run"]);

    expect(parseJson(res.stdout)).toMatchObject({
      data: { next_commands: [expect.stringContaining("setup")] },
    });
  });

  it.for(["zitadel.json", ".env.local", "Remove the Zitadel configuration block from vite.config"])(
    "tells a person on the terminal about %s",
    async (line) => {
      const cwd = await makeManagedViteProject();
      await writeFile(join(cwd, ".env.local"), "ZITADEL_PROJECT_ID=proj-001\n");

      const res = await runCliForTest(["eject", "--cwd", cwd, "--force"]);

      expect(stripAnsi(res.stdout)).toContain(line);
    },
  );
});

describe("eject asked on a terminal", () => {
  /** Runs eject in `cwd` with a person at the terminal giving `answers`. */
  const ejecting = async (cwd: string, ...answers: Answer[]) => {
    const talk = answering(...answers);
    const result = await asTerminal(() => Eject.run(["--cwd", cwd], cliPackageRoot));
    return { result, shown: talk.shown(), talk };
  };

  it("asks whether to remove the managed files and local state", async () => {
    const cwd = await makeManagedProject();

    const { talk } = await ejecting(cwd, false);

    expect(talk.asked()).toEqual(["Remove the managed files and local Zitadel state?"]);
  });

  it("is skipped, removing nothing, when the answer is no", async () => {
    const cwd = await makeManagedProject();

    const { result } = await ejecting(cwd, false);

    expect(JSON.parse(JSON.stringify(result))).toMatchObject({
      status: "skipped",
      reason: "eject-cancelled",
    });
    expect(await exists(join(cwd, "app/login/page.tsx"))).toBe(true);
  });

  it("removes the managed files when the answer is yes", async () => {
    const cwd = await makeManagedProject();

    const { result } = await ejecting(cwd, true);

    expect(JSON.parse(JSON.stringify(result))).toMatchObject({ status: "ok" });
    expect(await exists(join(cwd, "app/login/page.tsx"))).toBe(false);
  });

  // A declined run changed nothing, so its summary says what is still there
  // rather than repeating the refusal the closing line already made.
  it("says what a declined run left in place", async () => {
    const cwd = await makeManagedProject();

    const { shown } = await ejecting(cwd, false);

    expect(stripAnsi(shown)).toContain("Nothing was removed. Zitadel is still set up in this app.");
  });

  it("offers the eject command again when the answer is no", async () => {
    const cwd = await makeManagedProject();

    const { shown } = await ejecting(cwd, false);

    expect(stripAnsi(shown)).toContain("Remove it whenever you like:");
    expect(stripAnsi(shown)).toMatch(/\$ .* eject --cwd /);
  });

  it("offers the eject command again in the envelope when the answer is no", async () => {
    const cwd = await makeManagedProject();

    const { result } = await ejecting(cwd, false);

    expect(JSON.parse(JSON.stringify(result))).toMatchObject({
      next_commands: [expect.stringContaining("eject")],
    });
  });

  it("ends a declined run on the one dim footer", async () => {
    const cwd = await makeManagedProject();

    const { shown } = await ejecting(cwd, false);

    expect(stripAnsi(shown).trimEnd().split("\n").at(-1)).toBe("Cancelled");
  });

  it("never shows a person the reason the envelope carries", async () => {
    const cwd = await makeManagedProject();

    const { shown } = await ejecting(cwd, false);

    expect(stripAnsi(shown)).not.toContain("eject-cancelled");
  });

  it("points an app that was never set up at setup, not at the reason token", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-eject-untouched-"));
    tempDirs.push(cwd);

    const { shown } = await ejecting(cwd, true);

    expect(stripAnsi(shown)).toContain(
      "Zitadel is not set up in this app, so nothing was removed.",
    );
  });

  it("offers setup to an app that had nothing to remove", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-eject-untouched-"));
    tempDirs.push(cwd);

    const { shown } = await ejecting(cwd, true);

    expect(stripAnsi(shown)).toContain("Set it up whenever you like:");
  });

  it("does not ask on a dry run, which removes nothing", async () => {
    const cwd = await makeManagedProject();

    const talk = answering();

    await asTerminal(() => Eject.run(["--cwd", cwd, "--dry-run"], cliPackageRoot));

    expect(talk.asked()).toEqual([]);
  });

  it("fails, removing nothing, when the person walks away", async () => {
    const cwd = await makeManagedProject();

    await expect(ejecting(cwd)).rejects.toThrow();

    expect(await exists(join(cwd, "app/login/page.tsx"))).toBe(true);
  });
});
