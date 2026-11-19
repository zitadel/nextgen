/** The two states `team-status` defines, in the order the Teams tabs show them. */
export const TEAM_STATUSES = ["active", "deactivated"] as const;
export type TeamStatus = (typeof TEAM_STATUSES)[number];

/**
 * What the console calls each state. A deactivated team reads `Inactive`; the
 * value the API filters and returns stays `deactivated`.
 */
export const TEAM_STATUS_LABEL: Record<TeamStatus, string> = {
  active: "Active",
  deactivated: "Inactive",
};

/** A team's status in words; `undefined` leaves a state the API adds later to the badge. */
export function teamStatusLabel(status: string | undefined): string | undefined {
  const known = TEAM_STATUSES.find((value) => value === status);
  return known && TEAM_STATUS_LABEL[known];
}
