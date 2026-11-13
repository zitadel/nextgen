import type { api } from "@/api/zitadel";

/** An invitation as the project's list returns it: never its token or link. */
export type Invitation = Awaited<ReturnType<typeof api.listInvitations>>["invitations"][number];

/** The lean view the invitation page gets for a token (root ADR 086 §3). */
export type InvitationLookup = Awaited<ReturnType<typeof api.lookupInvitation>>;

/**
 * The inviter's name as the page shows it: `display`, falling back to
 * `identifier`, then `user_id` (ADR 058 §3). The lookup resolves them
 * (`inviter`, a user-ref) because the invited person cannot read the project's
 * users. Nothing when a project secret created the invitation.
 */
export function inviterLabel(lookup: Pick<InvitationLookup, "inviter">): string | undefined {
  const inviter = lookup.inviter;
  if (!inviter) return undefined;
  return inviter.display || inviter.identifier || inviter.user_id;
}

export type InvitationStatus = Invitation["status"];

/** A project role an invitation grants, named as in `POST /grants`. */
export type ProjectRelation = Extract<
  Invitation,
  { type: "project_member" }
>["project_member"]["relation"];

/** The roles in the order the invite dialog offers them, with what each allows. */
export const PROJECT_ROLES: readonly {
  relation: ProjectRelation;
  label: string;
  description: string;
}[] = [
  { relation: "admin", label: "Admin", description: "Manage members and project resources" },
  { relation: "editor", label: "Editor", description: "Manage project resources" },
  { relation: "viewer", label: "Viewer", description: "View project resources" },
];

const ROLE_LABEL: Record<ProjectRelation, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

/** What the type-specific part of an invitation grants, whichever type it is. */
type Grants =
  | { type: "project_member"; project_member: { relation: ProjectRelation } }
  | { type: "team_member"; team_member: { role: string } };

/** The role an invitation grants, as its row and its page label it. */
export function roleLabel(invitation: Grants): string {
  return invitation.type === "project_member"
    ? ROLE_LABEL[invitation.project_member.relation]
    : "Team member";
}

/** The label with its article, lower-cased for running text: `an editor`. */
export function roleInProse(invitation: Grants): string {
  const label = roleLabel(invitation).toLowerCase();
  return `${/^[aeiou]/.test(label) ? "an" : "a"} ${label}`;
}

/**
 * The `role` property of the invitation events (root ADR 086 §9): the type and
 * its role combined.
 */
export function analyticsRole(invitation: Grants): string {
  return invitation.type === "project_member"
    ? `project_${invitation.project_member.relation}`
    : "team_member";
}

/**
 * The status to show. The server derives `expired` on read, so a row read as
 * `pending` can pass its expiry while the page is open; the link is dead from
 * then on, and the row says so.
 */
export function effectiveStatus(
  invitation: Pick<Invitation, "status" | "expires_at">,
  now: Date = new Date(),
): InvitationStatus {
  if (invitation.status === "pending" && Date.parse(invitation.expires_at) <= now.getTime()) {
    return "expired";
  }
  return invitation.status;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * How long a pending invitation has left: `Expires in 3 days`. Days are
 * rounded to the nearest, so a link made a moment ago reads as the 72 hours it
 * was given rather than `2 days`; under a day it counts whole hours, rounded
 * down, where an hour more or less matters. `now` is a parameter so a test can
 * pin it.
 */
export function describeExpiry(expiresAt: string, now: Date = new Date()): string {
  const hours = (Date.parse(expiresAt) - now.getTime()) / HOUR_MS;
  if (Number.isNaN(hours)) return "";
  if (hours < 1) return "Expires in less than an hour";
  if (hours < 24) {
    const whole = Math.floor(hours);
    return `Expires in ${whole} ${whole === 1 ? "hour" : "hours"}`;
  }
  const days = Math.round(hours / 24);
  return `Expires in ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * The message an administrator copies and sends: the link is only useful with
 * what it is for and how long it lasts beside it.
 */
export function invitationMessage(projectName: string, invitation: Grants, link: string): string {
  return [
    `You're invited to join ${projectName} on Zitadel as ${roleInProse(invitation)}.`,
    "",
    "Accept the invitation:",
    link,
    "",
    "This link expires in 72 hours.",
  ].join("\n");
}
