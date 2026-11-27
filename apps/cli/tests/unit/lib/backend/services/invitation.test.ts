import type { CreateInvitation201, GetInvitation200 } from "@zitadel/api/generated/model";
import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { allowDestructive } from "@/lib/backend";

import { InvitationService, invitationRole } from "@/lib/backend/services/invitation";
import { answering, answeringPages } from "@tests/helpers/api-answers";

const PROJECT = "proj_1";
const INVITATION = "inv_1";

/** A project invitation as the API answers one, with only what a test varies. */
function projectInvitation(
  relation: "viewer" | "editor" | "admin" = "viewer",
): Extract<GetInvitation200, { type: "project_member" }> {
  return {
    id: INVITATION,
    project_id: PROJECT,
    type: "project_member",
    project_member: { relation },
    status: "pending",
    created_at: "2026-11-10T10:00:00Z",
    expires_at: "2026-11-13T10:00:00Z",
    journey_id: "journey_1",
  };
}

/** A created invitation, with the link only a create answers. */
function created(): CreateInvitation201 {
  return { ...projectInvitation(), link: "https://console.example.com/invitations#token=t" };
}

describe("InvitationService.create", () => {
  it.for([
    {
      what: "a role alone",
      input: { relation: "editor" as const },
      expected: { type: "project_member", project_member: { relation: "editor" } },
    },
    {
      what: "who it is for",
      input: { relation: "viewer" as const, name: "John Doe" },
      expected: {
        type: "project_member",
        project_member: { relation: "viewer" },
        metadata: { name: "John Doe" },
      },
    },
    {
      what: "the invitation it replaces",
      input: { relation: "admin" as const, replaces: "inv_0" },
      expected: {
        type: "project_member",
        project_member: { relation: "admin" },
        replaces_invitation_id: "inv_0",
      },
    },
  ])(
    "sends $what as the project invitation body",
    async ({ input, expected }, { server, client }) => {
      const sent = answering(server, "createInvitation", created());

      await new InvitationService(allowDestructive(client), PROJECT).create(input);

      expect(sent.map(({ url, body }) => [url.searchParams.get("project_id"), body])).toEqual([
        [PROJECT, expected],
      ]);
    },
  );

  it("answers the link the create returned", async ({ server, client }) => {
    answering(server, "createInvitation", created());

    const invitation = await new InvitationService(allowDestructive(client), PROJECT).create({
      relation: "viewer",
    });

    expect(invitation.link).toBe("https://console.example.com/invitations#token=t");
  });
});

describe("InvitationService.cancellable", () => {
  it("lists only the project's pending, expired and declined invitations", async ({
    server,
    client,
  }) => {
    const listed = answeringPages(server, "listInvitations", {
      invitations: [projectInvitation()],
    });

    await new InvitationService(allowDestructive(client), PROJECT).cancellable();

    expect(
      listed.map(({ url }) => [
        url.searchParams.get("project_id"),
        url.searchParams.getAll("status"),
      ]),
    ).toEqual([[PROJECT, ["pending", "expired", "rejected"]]]);
  });
});

describe("InvitationService.get", () => {
  it("reads the invitation in the service's project", async ({ server, client }) => {
    const read = answering(server, "getInvitation", projectInvitation());

    await new InvitationService(allowDestructive(client), PROJECT).get(INVITATION);

    expect(
      read.map(({ params, url }) => [params.invitation_id, url.searchParams.get("project_id")]),
    ).toEqual([[INVITATION, PROJECT]]);
  });
});

describe("InvitationService.cancel", () => {
  it("cancels the invitation in the service's project", async ({ server, client }) => {
    const cancelled = answering(server, "cancelInvitation", undefined);

    await new InvitationService(allowDestructive(client), PROJECT).cancel(INVITATION);

    expect(
      cancelled.map(({ params, url }) => [
        params.invitation_id,
        url.searchParams.get("project_id"),
      ]),
    ).toEqual([[INVITATION, PROJECT]]);
  });
});

describe("invitationRole", () => {
  it.each([
    ["a project invitation's relation", projectInvitation("editor"), "editor"],
    [
      "a team invitation's role",
      {
        ...projectInvitation(),
        type: "team_member" as const,
        team_member: { team_id: "team_1", role: "member" as const },
      },
      "member",
    ],
  ])("names %s", (_, invitation, role) => {
    expect(invitationRole(invitation)).toBe(role);
  });
});
