import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  connectionSlugs,
  providerToRemove,
  refuseUnknownProvider,
  removableFlows,
} from "../../../../../../src/commands/auth-method/sso/disable/index";
import { readSchemaTarget } from "../../../../../../src/commands/auth-method/command";
import { defaultSchema, setUpProject } from "../../../../../helpers/local-project";

function targetOf(cwd: string) {
  return readSchemaTarget({
    cwd,
    schema: undefined,
    cwdGiven: false,
  });
}

describe("providerToRemove", () => {
  it("is the provider that was named", async () => {
    const target = await targetOf(await setUpProject());

    expect(providerToRemove("github", target)).toBe("github");
  });

  it("refuses when none is named, listing what the schema offers", async () => {
    const target = await targetOf(
      await setUpProject({
        customers: {
          ...defaultSchema,
          "x-auth-methods": {
            sso: {
              enabled: true,
              providers: ["github"],
            },
          },
        },
      }),
    );

    expect(() => {
      providerToRemove(undefined, target);
    }).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: "Name the provider to remove",
        hint: "Pass --provider, e.g. --provider google. customers offers: github.",
      }),
    );
  });

  it("says when the schema offers none", async () => {
    const target = await targetOf(await setUpProject());

    expect(() => {
      providerToRemove(undefined, target);
    }).toThrow(
      expect.objectContaining({
        hint: expect.stringContaining("offers: none"),
      }),
    );
  });
});

describe("removableFlows", () => {
  it("is the flows that run against the schema", async () => {
    const target = await targetOf(await setUpProject());

    expect(removableFlows(target)).toHaveLength(1);
  });
});

describe("refuseUnknownProvider", () => {
  it("refuses a provider no connection names, listing what the schema offers", async () => {
    const target = await targetOf(
      await setUpProject({
        customers: {
          ...defaultSchema,
          "x-auth-methods": { sso: { enabled: true, providers: ["github"] } },
        },
      }),
    );

    expect(() => {
      refuseUnknownProvider("gogle", target, ["github"]);
    }).toThrow(
      expect.objectContaining({
        code: "E_NOT_FOUND",
        message: "customers has no provider named gogle",
        hint: "customers offers: github. Connections under .zitadel/idps/: github.",
        details: { requested: "gogle", offered: ["github"], connections: ["github"] },
      }),
    );
  });

  it("says when the schema offers none and no connection exists", async () => {
    const target = await targetOf(await setUpProject());

    expect(() => {
      refuseUnknownProvider("gogle", target, []);
    }).toThrow(
      expect.objectContaining({
        hint: "default-human-user offers: none. Connections under .zitadel/idps/: none.",
      }),
    );
  });

  it("lets through a provider a connection names", async () => {
    const target = await targetOf(await setUpProject());

    expect(() => {
      refuseUnknownProvider("acme-sso", target, ["acme-sso"]);
    }).not.toThrow();
  });

  it("lets through a provider the catalog lists, with no connection", async () => {
    const target = await targetOf(await setUpProject());

    expect(() => {
      refuseUnknownProvider("google", target, []);
    }).not.toThrow();
  });
});

describe("connectionSlugs", () => {
  async function withIdps(files: Record<string, string>): Promise<string> {
    const cwd = await setUpProject();
    await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      await writeFile(join(cwd, ".zitadel/idps", name), text);
    }
    return cwd;
  }

  it("is each file's slug, or its name when it has none", async () => {
    const cwd = await withIdps({
      "acme.json": JSON.stringify({ slug: "acme-sso" }),
      "google.json": JSON.stringify({ template: "google" }),
      "notes.txt": "not a connection",
    });

    expect(await connectionSlugs(cwd)).toEqual(["acme-sso", "google"]);
  });

  it("names a file that does not parse by its name", async () => {
    const cwd = await withIdps({ "okta.json": "{ broken," });

    expect(await connectionSlugs(cwd)).toEqual(["okta"]);
  });

  it("is empty without the directory", async () => {
    expect(await connectionSlugs(await setUpProject())).toEqual([]);
  });
});
