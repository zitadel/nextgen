/**
 * Console copy the suites assert on, retyped rather than imported: this
 * project does not compile console source. The journey's claim suite
 * (`journey/src/claim.spec.ts`) reads it too, which is why the journey lanes
 * list this file as an input. It imports nothing, so it stays that cheap to
 * depend on.
 */

/**
 * What Settings → Admins says on every accepted submit
 * (`apps/console/src/components/add-admin-dialog.tsx`), whether or not anyone
 * was granted.
 */
export const NEUTRAL_MESSAGE =
  "If the user exists in our system, they have been granted access to your project.";

/**
 * The title of any of the console's error states
 * (`apps/console/src/components/boundaries.tsx`): "Not authorized" for a 403,
 * "Request failed (<status>)" for any other refusal, "Console API not
 * authorized" for a session the server did not accept, the generic "Something
 * went wrong", and "Not found". One pattern for every lane: a state left off
 * it — "Console API not authorized" once was — lets a refused request pass as
 * a loaded screen.
 */
export const ERROR_STATE_TITLE =
  /^(?:Request failed \(\d+\)|Not authorized|Console API not authorized|Something went wrong|Not found)$/;
