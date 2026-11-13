import { describe, expect, it } from "vitest";

import DeploymentCreate from "@/commands/deployment/create";
import { parseFlag } from "@tests/helpers/inputs";
import { HttpResponse, http } from "msw";
import { asTerminal } from "@tests/helpers/terminal";
import { join } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { runCliForTest, stripAnsi } from "@tests/helpers/run-cli";
import { setupServer } from "msw/node";
import { tmpdir } from "node:os";
import { PRIMARY_ORIGIN } from "@tests/helpers/records";

describe("-m", () => {
  it("trims a message", async () => {
    await expect(
      parseFlag(DeploymentCreate.flags.message, "  add company  ", "message"),
    ).resolves.toBe("add company");
  });

  it("refuses a blank message", async () => {
    await expect(parseFlag(DeploymentCreate.flags.message, "   ", "message")).rejects.toMatchObject(
      {
        code: "E_VALIDATION",
        message: "the value is empty",
      },
    );
  });

  it("refuses a message longer than the server records, naming the limit", async () => {
    await expect(
      parseFlag(DeploymentCreate.flags.message, "x".repeat(1025), "message"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the message is longer than 1024 characters",
      hint: "Pass a shorter summary with -m.",
    });
  });

  it("counts code points, not UTF-16 units", async () => {
    await expect(
      parseFlag(DeploymentCreate.flags.message, "\u{1F600}".repeat(1024), "message"),
    ).resolves.toHaveLength(2048);
  });
});

describe("--release", () => {
  const RELEASE = "rel_01KX3RG8A7F0N9WD3P2E4YM5C1";

  it("takes a release id, trimmed", async () => {
    await expect(
      parseFlag(DeploymentCreate.flags.release, ` ${RELEASE}\n`, "release"),
    ).resolves.toBe(RELEASE);
  });

  it.each([
    ["a deployment id", "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6"],
    ["a blank", "   "],
    ["a prefix alone", "rel_"],
    ["a space inside", "rel_has space"],
  ])("refuses %s, saying what a release id is and where to list them", async (_, value) => {
    await expect(parseFlag(DeploymentCreate.flags.release, value, "release")).rejects.toMatchObject(
      {
        code: "E_VALIDATION",
        message: expect.stringContaining("must be a release ID"),
        hint: "List the releases to find one.",
      },
    );
  });
});

describe("deployment create at a terminal", () => {
  const SERVER = "https://api.zitadel.cloud";
  const server = setupServer();
  const dirs: string[] = [];

  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterAll(() => server.close());
  afterEach(async () => {
    server.resetHandlers();
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function aProject(origins: readonly string[]): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-deployment-create-"));
    dirs.push(cwd);
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/secret"),
      JSON.stringify({
        project_id: "proj_test",
        project_secret: "sk_test",
        preview_secret: "pk_test",
        preview_origins: [],
        created_at: "2026-01-01T00:00:00.000Z",
      }),
    );
    server.use(
      http.post(`${SERVER}/api/v1/deployments`, () =>
        HttpResponse.json({
          id: "dep_1",
          release_id: "rel_1",
          targets: origins.map((origin) => ({ origin, expires_at: null })),
          metadata: { reason: "deploy" },
          deployed_at: "2026-01-01T00:00:00.000Z",
        }),
      ),
    );
    return cwd;
  }

  const deploy = (cwd: string) =>
    asTerminal(() =>
      runCliForTest([
        "deployment",
        "create",
        "--release",
        "rel_1",
        "--cwd",
        cwd,
        "--server",
        SERVER,
        "--no-telemetry",
      ]),
    );

  describe("deployment create", () => {
    it("answers with one clause, and never a list item spliced into the footer", async () => {
      const cwd = await aProject([PRIMARY_ORIGIN]);

      const res = await deploy(cwd);

      expect(res.exitCode).toBe(0);
      const shown = stripAnsi(res.stdout);
      expect(shown).toContain("Deployed rel_1 · project proj_test");
      expect(shown).not.toContain(`- ${PRIMARY_ORIGIN}`);
    });

    it("names the origins in one sentence, not a list", async () => {
      const cwd = await aProject([PRIMARY_ORIGIN, "https://admin.acme.com"]);

      const res = await deploy(cwd);

      const shown = stripAnsi(res.stdout);
      expect(shown).toContain(`Live on ${PRIMARY_ORIGIN} and https://admin.acme.com.`);
    });
  });
});
