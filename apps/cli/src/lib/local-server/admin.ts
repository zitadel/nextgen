/**
 * The local admin: an account `zitadel start` creates on a CLI-managed server
 * so a developer exists there without signing up, and their local projects are
 * owned from the start.
 *
 * Split by job, re-exported here because callers think of it as one feature:
 *
 * - `admin-credential` — minting and reading the credential, and the bootstrap
 *   user document the server imports.
 * - `sign-in` — turning that credential into a console sign-in link or a
 *   session cookie.
 * - `claim-as-admin` — attaching a newly created project to the admin's team.
 */
export {
  ensureLocalAdmin,
  readLocalAdmin,
  LOCAL_ADMIN_EMAIL,
  LOCAL_ADMIN_FILE,
  LOCAL_ADMIN_USER_FILE,
  type LocalAdmin,
} from "./admin-credential";
export { consoleSignInUrl } from "./sign-in";
export { claimProjectAsAdmin, type ProjectOwner } from "./claim-as-admin";
