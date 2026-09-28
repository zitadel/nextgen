/**
 * Design-ahead fixture for Settings › Members.
 *
 * NextGen has no team-member or invite API yet: `POST /grants` gives an
 * existing person admin access to a project (the Project settings page's
 * Admins section), but there is no invite, no pending state and nothing to
 * resend or revoke. The Figma `Admins` frames design all of those, so the
 * screen renders from this static list until the endpoints exist. Changes made
 * on the screen live in component state and are lost on reload.
 *
 * The MVP has one role — project admin — so members carry no level.
 */

export interface SettingsMember {
  id: string;
  name?: string;
  email: string;
  /** `pending` is an invite that has not been accepted yet. */
  status: "active" | "pending";
}

/** What the "You left …" toast names; the fixture's team. */
export const FIXTURE_TEAM_NAME = "Acme";

export const SETTINGS_MEMBERS: SettingsMember[] = [
  { id: "member_01", name: "Alex Morgan", email: "alex.morgan@acme.dev", status: "active" },
  { id: "member_02", name: "Priya Raman", email: "priya.raman@acme.dev", status: "active" },
  { id: "member_03", name: "Lena Fischer", email: "lena.fischer@acme.dev", status: "active" },
  { id: "member_04", email: "sam.lee@partner.io", status: "pending" },
];
