import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp } from "../helpers/project";
import { expectedPublicCliCommand, parseJson, runCliForTest } from "../helpers/run-cli";

usePlatformMock();

describe("the cli", () => {
  it("leaves an unknown command to oclif and emits no envelope", async () => {
    const result = await runCliForTest(["bogus", "--json"]);

    expect(result.exitCode).toBe(127);
    expect(result.stdout.trim()).toBe("");
  });

  it("names the failure and the way out when run before setup", async () => {
    const app = await anApp();

    const result = await app.apply();

    expect(result).toFailWith("E_VALIDATION");
    expect(result).toSuggest(expectedPublicCliCommand("setup"));
  });

  it("resolves the real server when nothing says otherwise", async () => {
    const app = await anApp();

    const result = await app.runWithoutServer(["status", "--json"]);

    expect(app.envelopeOf(result).source).toBe("https://api.zitadel.cloud");
  });

  it("prefers the server named in zitadel.json", async () => {
    const app = await anApp();
    await app.writeProjectFile(
      "zitadel.json",
      JSON.stringify({
        $schema: "https://schemas.zitadel.com/v2/project.schema.json",
        project: "existing",
        server: "https://self.example",
      }),
    );

    const result = await app.runWithoutServer(["status", "--json"]);

    expect(app.envelopeOf(result).source).toBe("https://self.example");
  });

  it("only ever suggests commands a user can run", async () => {
    const listed = await runCliForTest(["commands", "--json"]);
    expect(listed.exitCode).toBe(0);
    const visible = new Set(
      (parseJson(listed.stdout) as Array<{ id?: unknown }>)
        .map((command) => command.id)
        .filter((id): id is string => typeof id === "string"),
    );

    const suggested = await suggestedCommandIds();

    expect([...suggested].sort()).toEqual(
      expect.arrayContaining(["apply", "doctor", "setup"]),
    );
    for (const command of suggested) {
      expect(visible, `${command} is suggested but not a visible command`).toContain(command);
    }
  });
});

/** Every command id the source suggests through `publicCliCommand` or copy. */
async function suggestedCommandIds(): Promise<Set<string>> {
  const commands = new Set<string>();
  for (const file of await typescriptFiles(join(import.meta.dirname, "../../src"))) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/publicCliCommand\(\s*(["`])([^"`$]*)/g)) {
      const id = commandIdFromArgs(match[2]);
      if (id) commands.add(id);
    }
    for (const match of source.matchAll(/["`]zitadel\s+([^"`]*)/g)) {
      const id = commandIdFromArgs(match[1] ?? "");
      if (id) commands.add(id);
    }
  }
  return commands;
}

/** `"sso enable --flag"` and `"sso:enable"` both name the id `sso:enable`. */
function commandIdFromArgs(args: string): string | undefined {
  const words: string[] = [];
  for (const token of args.trim().split(/\s+/)) {
    if (!/^[a-z][\w:-]*$/.test(token)) break;
    words.push(token);
  }
  return words.length > 0 ? words.join(":") : undefined;
}

async function typescriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await typescriptFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}
