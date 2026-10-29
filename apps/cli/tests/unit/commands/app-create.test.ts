import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { makeProject, readJson } from "../../helpers/local-project";
import { parseJson, runCliForTest } from "../../helpers/run-cli";

type Envelope = {
  status: string;
  code?: string;
  message?: string;
  hint?: string;
  data?: Record<string, unknown>;
};

async function run(cwd: string, ...args: string[]) {
  const result = await runCliForTest([
    "apps",
    "create",
    "--cwd",
    cwd,
    "--json",
    "--non-interactive",
    ...args,
  ]);
  return { exitCode: result.exitCode, envelope: parseJson(result.stdout) as Envelope };
}

const WEB = ["shop", "--preset", "web", "--redirect-uri", "https://shop.example.com/callback"];

describe("apps create", () => {
  it("declares the app as a file of the release, from its preset", async () => {
    const cwd = await makeProject();

    const { exitCode } = await run(cwd, ...WEB);

    expect(exitCode).toBe(0);
    expect(await readJson(cwd, ".zitadel/apps/shop.json")).toEqual({
      $schema: "../meta/app.json",
      slug: "shop",
      name: "shop",
      preset: "web",
      clients: [
        {
          slug: "web",
          type: "confidential",
          secret: "${{ SHOP_WEB_CLIENT_SECRET }}",
          grants: ["authorization_code", "refresh_token"],
          redirect_uris: ["https://shop.example.com/callback"],
        },
      ],
    });
  });

  it("names the variables to set before the deploy that declares the app", async () => {
    const cwd = await makeProject();

    const { envelope } = await run(cwd, ...WEB);

    expect(envelope.data?.variables).toEqual(["SHOP_WEB_CLIENT_SECRET"]);
    const next = envelope.data?.next_commands as string[];
    expect(next[0]).toMatch(/variable set SHOP_WEB_CLIENT_SECRET --secret/);
    expect(next.at(-1)).toMatch(/deploy/);
  });

  it("adds the app meta-schemas an older project lacks, so an editor validates the file", async () => {
    const cwd = await makeProject();

    await run(cwd, ...WEB);

    for (const name of ["app.json", "app-client.json", "app-api.json", "app-registration.json"]) {
      expect(existsSync(join(cwd, ".zitadel/meta", name)), name).toBe(true);
    }
  });

  it("never overwrites an app file", async () => {
    const cwd = await makeProject();
    await mkdir(join(cwd, ".zitadel/apps"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/apps/shop.json"), JSON.stringify({ slug: "shop", name: "Mine" }));

    const { exitCode, envelope } = await run(cwd, ...WEB);

    expect(exitCode).not.toBe(0);
    expect(envelope.code).toBe("E_CONFLICT");
    expect(await readJson(cwd, ".zitadel/apps/shop.json")).toEqual({ slug: "shop", name: "Mine" });
  });

  it("asks for what the preset needs, and names the flag when nobody can answer", async () => {
    const cwd = await makeProject();

    const { exitCode, envelope } = await run(cwd, "shop", "--preset", "mcp-server");

    expect(exitCode).not.toBe(0);
    expect(envelope.code).toBe("E_VALIDATION");
    expect(envelope.hint).toMatch(/--identifier <uri>/);
    expect(existsSync(join(cwd, ".zitadel/apps/shop.json"))).toBe(false);
  });

  it("refuses a slug the app schema would", async () => {
    const cwd = await makeProject();

    const { envelope } = await run(cwd, "Shop!", "--preset", "cli");

    expect(envelope.code).toBe("E_VALIDATION");
  });

  it("writes nothing on a dry run", async () => {
    const cwd = await makeProject();

    const { envelope } = await run(cwd, ...WEB, "--dry-run");

    expect(envelope.data?.path).toBe(".zitadel/apps/shop.json");
    expect(existsSync(join(cwd, ".zitadel/apps/shop.json"))).toBe(false);
  });
});
