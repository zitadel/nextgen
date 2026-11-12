import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import ReleaseCreate from "@/commands/release/create";
import { parseFlag } from "@tests/helpers/inputs";
import { HttpResponse, http } from "msw";
import { asTerminal } from "@tests/helpers/terminal";
import { makeProject } from "@tests/helpers/local-project";
import { runCliForTest, stripAnsi } from "@tests/helpers/run-cli";
import { setupServer } from "msw/node";

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
  const SERVER = "https://api.zitadel.cloud";
  const HASH = `sha256:${"d9b331a42e4e2d770718644ee48b679d9ffa7c3821f84d6e6ca849d4e2377691"}`;
  const server = setupServer();

  /** A user-schema the server would accept, so the bundle validates. */
  const SCHEMA = {
    objectType: "human-user",
    kind: "user-schema",
    metaSchema: "https://example.com/meta/user-schema.json",
    "x-auth-methods": { password: { enabled: true } },
    "x-identifier": "email",
    properties: { email: { "x-unique": "project" } },
  };

  beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
  afterAll(() => server.close());
  const dirs: string[] = [];
  afterEach(async () => {
    server.resetHandlers();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  const created = async (): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-release-create-"));
    dirs.push(dir);
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
    it("keeps what it did in the footer, rather than losing it to a long headline", async () => {
      const out = await created();

      // The footer carries what the command did, with the place after it.
      expect(out).toContain("Created rel_1 · project proj_01TEST");
      expect(out).not.toMatch(/^\s*project proj_01TEST on/m);
    });

    it("leaves the content digest to --json and release get", async () => {
      const out = await created();

      expect(out).not.toContain(HASH);
    });
  });
});
