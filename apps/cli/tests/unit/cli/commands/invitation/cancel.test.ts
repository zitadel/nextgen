import { rm } from "node:fs/promises";

import { HttpResponse, http } from "msw";
import type { SetupServer } from "msw/node";
import { afterEach, describe, expect } from "vitest";

import InvitationCancel from "@/cli/commands/invitation/cancel";
import { it } from "@tests/helpers/fixtures";
import { parseArg } from "@tests/helpers/inputs";
import { answering } from "@tests/helpers/keyboard";
import { aProjectDirectory } from "@tests/helpers/platform-project";
import { parseJson, runCliForTest, runCommand } from "@tests/helpers/run-cli";
import { asTerminal } from "@tests/helpers/terminal";
import { rejectionOf } from "@tests/helpers/thrown-value";

const INVITATION = "inv_01JCQK5R7T9V1X3Z5B7D9F1H3J";

describe("invitation cancel", () => {
  describe("with invitation_id", () => {
    it("takes an invitation id, trimmed", async () => {
      await expect(
        parseArg(InvitationCancel.args.invitation_id, ` ${INVITATION}\n`, "invitation_id"),
      ).resolves.toBe(INVITATION);
    });

    it.each([
      ["a blank", "   "],
      ["a space inside", "inv_has space"],
    ])("refuses %s, saying where to list the invitations it can cancel", async (_, value) => {
      await expect(
        parseArg(InvitationCancel.args.invitation_id, value, "invitation_id"),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        hint: "Find one with `zitadel invitation list --status pending --status rejected`.",
      });
    });
  });
});

/** The server the command is pointed at, which the test's msw server answers. */
const SERVER = "https://api.zitadel.example";

/** A pending invitation as the API lists one. */
function pending(id: string, name: string) {
  return {
    id,
    project_id: "proj_unit",
    type: "project_member",
    project_member: { relation: "viewer" },
    metadata: { name },
    status: "pending",
    created_at: "2026-11-10T10:00:00Z",
    expires_at: "2026-11-13T10:00:00Z",
    journey_id: `journey_${id}`,
  };
}

/** The ids the server was asked to cancel. */
const cancelled: string[] = [];

/** Lists `invitations` as the project's pending ones, and records every cancel. */
function listing(server: SetupServer, invitations: readonly ReturnType<typeof pending>[]): void {
  cancelled.length = 0;
  server.use(
    http.get(`${SERVER}/api/v1/invitations`, () => {
      return HttpResponse.json({ invitations });
    }),
    http.delete(`${SERVER}/api/v1/invitations/:id`, ({ params }) => {
      cancelled.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** A project directory the command reads its credentials from. */
async function anApp(): Promise<string> {
  const cwd = await aProjectDirectory("zitadel-invitation-cancel-", {
    id: "proj_unit",
    secret: "sk_unit",
  });
  dirs.push(cwd);
  return cwd;
}

describe("invitation cancel, run by a person without an id", () => {
  it("offers the pending invitations, with who each is for", async ({ server }) => {
    listing(server, [pending("inv_1", "John Doe"), pending("inv_2", "Jane Roe")]);
    const cwd = await anApp();
    const talk = answering();

    await rejectionOf(() => {
      return asTerminal(() => {
        return runCommand(InvitationCancel, "invitation:cancel", [
          "--cwd",
          cwd,
          "--server",
          SERVER,
        ]);
      });
    });

    expect(talk.options()[0]).toEqual([
      expect.stringContaining("inv_1"),
      expect.stringContaining("inv_2"),
    ]);
  });

  it("refuses when nothing is pending, before asking", async ({ server }) => {
    listing(server, []);
    const cwd = await anApp();
    const talk = answering();

    await rejectionOf(() => {
      return asTerminal(() => {
        return runCommand(InvitationCancel, "invitation:cancel", [
          "--cwd",
          cwd,
          "--server",
          SERVER,
        ]);
      });
    });

    expect(talk.asked()).toEqual([]);
  });
});

describe("invitation cancel, with nobody to ask", () => {
  it("refuses a missing id without asking the server", async () => {
    const cwd = await anApp();

    const result = await runCliForTest([
      "invitation",
      "cancel",
      "--json",
      "--cwd",
      cwd,
      "--server",
      SERVER,
    ]);

    expect(parseJson(result.stdout)).toMatchObject({ code: "E_VALIDATION" });
  });

  it("cancels nothing without --force", async ({ server }) => {
    listing(server, [pending("inv_1", "John Doe")]);
    const cwd = await anApp();

    await runCliForTest([
      "invitation",
      "cancel",
      "inv_1",
      "--json",
      "--cwd",
      cwd,
      "--server",
      SERVER,
    ]);

    expect(cancelled).toEqual([]);
  });
});
