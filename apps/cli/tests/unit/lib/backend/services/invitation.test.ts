import type { CreateInvitation201, GetInvitation200 } from "@zitadel/api/generated/model";
import { describe, expect, it, vi } from "vitest";

import { InvitationService, invitationRole } from "@/lib/backend/services/invitation";
import { fakeClient } from "@tests/helpers/fake-client";

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
  it.each([
    [
      "a role alone",
      { relation: "editor" as const },
      { type: "project_member", project_member: { relation: "editor" } },
    ],
    [
      "who it is for",
      { relation: "viewer" as const, name: "John Doe" },
      {
        type: "project_member",
        project_member: { relation: "viewer" },
        metadata: { name: "John Doe" },
      },
    ],
    [
      "the invitation it replaces",
      { relation: "admin" as const, replaces: "inv_0" },
      {
        type: "project_member",
        project_member: { relation: "admin" },
        replaces_invitation_id: "inv_0",
      },
    ],
  ])("sends %s as the project invitation body", async (_, input, body) => {
    const createInvitation = vi.fn(async () => created());
    const service = new InvitationService(fakeClient({ createInvitation }), PROJECT);

    await service.create(input);

    expect(createInvitation).toHaveBeenCalledWith(body, { project_id: PROJECT });
  });

  it("answers the link the create returned", async () => {
    const service = new InvitationService(
      fakeClient({ createInvitation: async () => created() }),
      PROJECT,
    );

    const invitation = await service.create({ relation: "viewer" });

    expect(invitation.link).toBe("https://console.example.com/invitations#token=t");
  });
});

describe("InvitationService.cancellable", () => {
  it("lists only the project's pending and declined invitations", async () => {
    const all = vi.fn(async () => [projectInvitation()]);
    const service = new InvitationService(fakeClient({ listInvitations: { all } }), PROJECT);

    await service.cancellable();

    expect(all).toHaveBeenCalledWith({ project_id: PROJECT, status: ["pending", "rejected"] });
  });
});

describe("InvitationService.get", () => {
  it("reads the invitation in the service's project", async () => {
    const getInvitation = vi.fn(async () => projectInvitation());
    const service = new InvitationService(fakeClient({ getInvitation }), PROJECT);

    await service.get(INVITATION);

    expect(getInvitation).toHaveBeenCalledWith(INVITATION, { project_id: PROJECT });
  });
});

describe("InvitationService.cancel", () => {
  it("cancels the invitation in the service's project", async () => {
    const cancelInvitation = vi.fn(async () => undefined);
    const service = new InvitationService(fakeClient({ cancelInvitation }), PROJECT);

    await service.cancel(INVITATION);

    expect(cancelInvitation).toHaveBeenCalledWith(INVITATION, { project_id: PROJECT });
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
