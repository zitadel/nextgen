import { describe, expect } from "vitest";

import ReleaseCreate from "@/cli/commands/release/create";
import { it } from "@tests/fixtures";
import { parseFlag } from "@tests/helpers/inputs";
import { HttpResponse, http } from "msw";
import type { SetupServer } from "msw/node";
import { asTerminal } from "@tests/fixtures/terminal";
import { makeProject } from "@tests/helpers/local-project";
import { runCliForTest, stripAnsi } from "@tests/helpers/run-cli";

describe("-m", () => {
  it("trims a message", async () => {
    await expect(
      parseFlag(ReleaseCreate.flags.message, "  add company  ", "message"),
    ).resolves.toBe("add company");
  });

  it("refuses a blank message", async () => {
    await expect(parseFlag(ReleaseCreate.flags.message, "   ", "message")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the value is empty",
    });
  });

  it("refuses a message longer than the server records, naming the limit", async () => {
    await expect(
      parseFlag(ReleaseCreate.flags.message, "x".repeat(1025), "message"),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the message is longer than 1024 characters",
      hint: "Pass a shorter summary with -m.",
    });
  });

  it("counts code points, not UTF-16 units", async () => {
    await expect(
      parseFlag(ReleaseCreate.flags.message, "\u{1F600}".repeat(1024), "message"),
    ).resolves.toHaveLength(2048);
  });
});

describe("release create at a terminal", () => {
  const SERVER = "https://preview.zitadel.com";
  const HASH = `sha256:${"d9b331a42e4e2d770718644ee48b679d9ffa7c3821f84d6e6ca849d4e2377691"}`;

  /** A user-schema the server would accept, so the bundle validates. */
  const SCHEMA = {
    objectType: "human-user",
    kind: "user-schema",
    metaSchema: "https://example.com/meta/user-schema.json",
    "x-auth-methods": { password: { enabled: true } },
    "x-identifier": "email",
    properties: { email: { "x-unique": "project" } },
  };

  /**
   * Runs `release create` at a terminal against a linked project.
   *
   * @param server - The msw server that answers the build.
   * @param dir - The directory the project is made in.
   * @returns What the command printed, without colour.
   */
  const created = async (server: SetupServer, dir: string): Promise<string> => {
    const cwd = await makeProject(dir, { linked: true, schemas: { "human-user": SCHEMA } });
    server.use(
      http.post(`${SERVER}/api/v1/releases/build`, () =>
        HttpResponse.json({
          id: "rel_1",
          project_id: "proj_01TEST",
          content_hash: HASH,
          revoked_at: null,
          metadata: {},
        }),
      ),
    );
    const res = await asTerminal(() =>
      runCliForTest(["release", "create", "--cwd", cwd, "--server", SERVER, "--no-telemetry"]),
    );
    expect(res.exitCode).toBe(0);
    return stripAnsi(res.stdout);
  };

  describe("release create", () => {
    it("keeps what it did in the footer, rather than losing it to a long headline", async ({
      server,
      dir,
    }) => {
      const out = await created(server, dir);

      // The footer carries what the command did, with the place after it.
      expect(out).toContain("Created rel_1 · project proj_01TEST");
      expect(out).not.toMatch(/^\s*project proj_01TEST on/m);
    });

    it("leaves the content digest to --json and release get", async ({ server, dir }) => {
      const out = await created(server, dir);

      expect(out).not.toContain(HASH);
    });
  });
});
