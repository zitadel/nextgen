import type { api } from "@/api/zitadel";
import { errorCode, errorDetails } from "@/lib/api-error";

/** An invitation as the project's list returns it: never its token or link. */
export type Invitation = Awaited<ReturnType<typeof api.listInvitations>>["invitations"][number];

/** The lean view the invitation page gets for a token (root ADR 086 §3). */
export type InvitationLookup = Awaited<ReturnType<typeof api.lookupInvitation>>;

/**
 * The inviter's name as the console shows it: `display`, falling back to
 * `identifier`, then `user_id` (ADR 058 §3). The server resolves them
 * (`inviter`, a user-ref) on the lookup and, with `expand=inviter`, on the
 * list, because the reader may not be able to read the project's users.
 * Nothing when a project secret created the invitation.
 */
export function inviterLabel(invitation: Pick<InvitationLookup, "inviter">): string | undefined {
  const inviter = invitation.inviter;
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

const ROLE_LABEL = Object.fromEntries(
  PROJECT_ROLES.map((role) => [role.relation, role.label]),
) as Record<ProjectRelation, string>;

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

/** What a create or a replace returned that the console shows: the link, once. */
export interface CreatedInvitation {
  relation: ProjectRelation;
  link: string;
}

/** What the invitation page found for the link it was opened with. */
export type InvitationPageState =
  /** A pending invitation, and the token that spends it. */
  | { kind: "open"; token: string; invitation: InvitationLookup }
  /** No token, an unknown one, or an invitation that is finished. */
  | { kind: "unavailable" }
  /** The lookup failed for another reason; the token is kept for a retry. */
  | { kind: "error"; message: string };

/**
 * The answers that mean the link can never be used: the API's one answer for
 * every unknown or finished token (root ADR 086 §10), and the refusal of a
 * link whose creator no longer administers the project, which no retry and no
 * other account changes.
 */
const DEAD_LINK = new Set(["inv.not_found", "inv.inviter_not_admin"]);

/** Whether a failed call says the link is finished, rather than that the call failed. */
export function isInvitationGone(cause: unknown): boolean {
  const code = errorCode(cause);
  return code !== undefined && DEAD_LINK.has(code);
}

/**
 * The access the signed-in person already has to an invitation's project
 * (#3330). Someone with access can neither accept nor decline: the link stays
 * pending for the person it was meant for. `relation` is their strongest role,
 * and is missing only when the server refused without naming it.
 */
export interface HeldAccess {
  relation?: ProjectRelation;
}

/** The access the lookup says the signed-in person already has, if any. */
export function heldAccess(invitation: InvitationLookup): HeldAccess | undefined {
  const membership = invitation.type === "project_member" ? invitation.membership : undefined;
  return membership ? { relation: membership.relation } : undefined;
}

/**
 * The access a refused accept or decline names (`409 inv.already_member`):
 * the person was given access after the page was loaded.
 */
export function heldAccessOf(cause: unknown): HeldAccess | undefined {
  if (errorCode(cause) !== "inv.already_member") return undefined;
  const relation = errorDetails(cause)?.relation;
  return { relation: isProjectRelation(relation) ? relation : undefined };
}

function isProjectRelation(value: unknown): value is ProjectRelation {
  return typeof value === "string" && value in ROLE_LABEL;
}

/** What the page tells someone who already has access to the project. */
export function describeHeldAccess(access: HeldAccess, projectName: string): string {
  const role = access.relation ? `${ROLE_LABEL[access.relation].toLowerCase()} ` : "";
  return `You already have ${role}access to ${projectName}. To change your role, ask a project admin.`;
}

/** Whether a looked-up invitation can still be acted on. */
export function isOpen(invitation: InvitationLookup): boolean {
  return effectiveStatus(invitation) === "pending";
}
