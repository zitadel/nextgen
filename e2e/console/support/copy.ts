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
 * The titles the error boundary gives a route whose loader failed
 * (`describeBoundaryError` in `apps/console/src/components/boundaries.tsx`):
 * "Not authorized" for a 403, "Request failed (<status>)" for any other
 * refusal, and the generic "Something went wrong". For asserting that a read
 * was refused: the not-found state is left out on purpose, because the router
 * renders it only for a path no route matches, and a broken route must not
 * pass for refused access.
 */
export const ERROR_BOUNDARY_TITLE =
  /^(?:Not authorized|Request failed \(\d+\)|Something went wrong)$/;

/**
 * The title of any of the console's error states: the boundary's three above,
 * "Console API not authorized" for a session the server did not accept, and
 * "Not found". For asserting that no error state rendered at all: a state left
 * off it — "Console API not authorized" once was — lets a refused request pass
 * as a loaded screen.
 */
export const ERROR_STATE_TITLE =
  /^(?:Not authorized|Request failed \(\d+\)|Something went wrong|Console API not authorized|Not found)$/;
