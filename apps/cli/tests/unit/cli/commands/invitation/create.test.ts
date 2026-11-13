import { rm } from "node:fs/promises";

import { HttpResponse, http } from "msw";
import type { SetupServer } from "msw/node";
import { afterEach, describe, expect } from "vitest";

import InvitationCreate from "@/cli/commands/invitation/create";
import { it } from "@tests/helpers/fixtures";
import { parseFlag } from "@tests/helpers/inputs";
import { answering } from "@tests/helpers/keyboard";
import { aProjectDirectory } from "@tests/helpers/platform-project";
import { parseJson, runCliForTest, runCommand } from "@tests/helpers/run-cli";
import { asTerminal } from "@tests/helpers/terminal";
import { rejectionOf } from "@tests/helpers/thrown-value";

const INVITATION = "inv_01JCQK5R7T9V1X3Z5B7D9F1H3J";

/** One character past the longest name the API stores. */
const TOO_LONG = "x".repeat(201);

/** 200 characters that are 400 UTF-16 units: within the API's limit. */
const WIDE = "😀".repeat(200);

describe("invitation create", () => {
  describe("with --name", () => {
    it("takes a name, trimmed", async () => {
      await expect(parseFlag(InvitationCreate.flags.name, "  John Doe ", "name")).resolves.toBe(
        "John Doe",
      );
    });

    it("counts characters, not UTF-16 units, against the limit", async () => {
      await expect(parseFlag(InvitationCreate.flags.name, WIDE, "name")).resolves.toBe(WIDE);
    });

    it.each([
      ["a blank", "   "],
      ["a name over 200 characters", TOO_LONG],
    ])("refuses %s, saying how long a name may be", async (_, value) => {
      await expect(parseFlag(InvitationCreate.flags.name, value, "name")).rejects.toMatchObject({
        code: "E_VALIDATION",
        hint: "Pass a name of 1 to 200 characters, or leave --name out.",
      });
    });
  });

  describe("with --replaces", () => {
    it("takes an invitation id, trimmed", async () => {
      await expect(
        parseFlag(InvitationCreate.flags.replaces, ` ${INVITATION}\n`, "replaces"),
      ).resolves.toBe(INVITATION);
    });

    it.each([
      ["a blank", "   "],
      ["a space inside", "inv_has space"],
    ])("refuses %s, saying where to list invitations", async (_, value) => {
      await expect(
        parseFlag(InvitationCreate.flags.replaces, value, "replaces"),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        hint: "Find one with `zitadel invitation list`.",
      });
    });
  });
});

/** The server the command is pointed at, which the test's msw server answers. */
const SERVER = "https://api.zitadel.example";

/** An invitation as the API answers a read of one, in the status a test needs. */
function stored(status: "pending" | "accepted") {
  return {
    id: INVITATION,
    project_id: "proj_unit",
    type: "project_member",
    project_member: { relation: "viewer" },
    metadata: { name: "John Doe" },
    status,
    created_at: "2026-11-10T10:00:00Z",
    expires_at: "2026-11-13T10:00:00Z",
    journey_id: "journey_1",
  };
}

/** The create requests the server received. */
const posted: unknown[] = [];

/** Answers a read of {@link INVITATION} in `status`, and records every create. */
function answeringReads(server: SetupServer, status: "pending" | "accepted"): void {
  posted.length = 0;
  server.use(
    http.get(`${SERVER}/api/v1/invitations/:id`, () => {
      return HttpResponse.json(stored(status));
    }),
    http.post(`${SERVER}/api/v1/invitations`, async ({ request }) => {
      posted.push(await request.json());
      return HttpResponse.json(
        { ...stored("pending"), link: "https://x/#token=t" },
        { status: 201 },
      );
    }),
  );
}

/** A project directory the command reads its credentials from. */
async function anApp(dirs: string[]): Promise<string> {
  const cwd = await aProjectDirectory("zitadel-invitation-create-", {
    id: "proj_unit",
    secret: "sk_unit",
  });
  dirs.push(cwd);
  return cwd;
}

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("invitation create, run by a person", () => {
  it("asks who it is for, which role, then whether to create, in that order", async ({
    server,
  }) => {
    answeringReads(server, "pending");
    const cwd = await anApp(dirs);
    const talk = answering("John Doe", "editor", false);

    await asTerminal(() => {
      return runCommand(InvitationCreate, "invitation:create", ["--cwd", cwd, "--server", SERVER]);
    });

    expect(talk.asked()).toEqual([
      "Who is this invitation for?",
      "Which role should whoever accepts receive on the project?",
      "Create an invitation for John Doe as editor?",
    ]);
  });

  it("creates nothing when the person says no", async ({ server }) => {
    answeringReads(server, "pending");
    const cwd = await anApp(dirs);
    answering("John Doe", "editor", false);

    await asTerminal(() => {
      return runCommand(InvitationCreate, "invitation:create", ["--cwd", cwd, "--server", SERVER]);
    });

    expect(posted).toEqual([]);
  });

  it("refuses an accepted --replaces before asking anything", async ({ server }) => {
    answeringReads(server, "accepted");
    const cwd = await anApp(dirs);
    const talk = answering();

    await rejectionOf(() => {
      return asTerminal(() => {
        return runCommand(InvitationCreate, "invitation:create", [
          "--replaces",
          INVITATION,
          "--cwd",
          cwd,
          "--server",
          SERVER,
        ]);
      });
    });

    expect(talk.asked()).toEqual([]);
  });

  it("asks no name for a replacement, which keeps the original's", async ({ server }) => {
    answeringReads(server, "pending");
    const cwd = await anApp(dirs);
    const talk = answering("viewer", false);

    await asTerminal(() => {
      return runCommand(InvitationCreate, "invitation:create", [
        "--replaces",
        INVITATION,
        "--cwd",
        cwd,
        "--server",
        SERVER,
      ]);
    });

    expect(talk.asked()).toEqual([
      "Which role should whoever accepts receive on the project?",
      `Create an invitation for John Doe as viewer, replacing ${INVITATION}?`,
    ]);
  });
});

describe("invitation create --dry-run", () => {
  it("sends no create", async ({ server }) => {
    answeringReads(server, "pending");
    const cwd = await anApp(dirs);

    await runCliForTest([
      "invitation",
      "create",
      "--relation",
      "viewer",
      "--dry-run",
      "--json",
      "--cwd",
      cwd,
      "--server",
      SERVER,
    ]);

    expect(posted).toEqual([]);
  });

  it("refuses an accepted --replaces, as the real run does", async ({ server }) => {
    answeringReads(server, "accepted");
    const cwd = await anApp(dirs);

    const result = await runCliForTest([
      "invitation",
      "create",
      "--relation",
      "viewer",
      "--replaces",
      INVITATION,
      "--dry-run",
      "--json",
      "--cwd",
      cwd,
      "--server",
      SERVER,
    ]);

    expect(parseJson(result.stdout)).toMatchObject({ code: "E_VALIDATION" });
  });
});
