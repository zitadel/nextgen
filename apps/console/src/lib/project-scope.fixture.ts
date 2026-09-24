/**
 * Test fixture: the selected project specs open scoped screens under. It is the
 * session fixture's own project (`makeTestSession`), the case where every
 * scoped screen — the users list included — reads it.
 */
export const TEST_PROJECT_ID = "proj_test";

/** `path` with the selected project in its query, as the `_authed` layout retains it. */
export function scopedPath(path: string, project: string = TEST_PROJECT_ID): string {
  return `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(project)}`;
}
