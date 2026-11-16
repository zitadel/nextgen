import {
  ensureLocalAdmin,
  findLocalAdminDir,
  findLocalAdminFor,
  LOCAL_ADMIN_FILE,
  readLocalAdmin,
} from "./local/admin-credential";

export type { LocalAdmin } from "./local/admin-credential";

/**
 * The administrator `zitadel start` creates for a local server, and where its
 * credential is kept: found by walking up from a directory, read, or created.
 */
export class LocalAdmins {
  /** The credential's file, from a project's root. */
  static readonly FILE: string = LOCAL_ADMIN_FILE;

  /** The directory holding the admin: `cwd`, or the nearest parent a server was started in. */
  static readonly findDir = findLocalAdminDir;

  /** The nearest admin, from `cwd` upward, of the server at an address. */
  static readonly findFor = findLocalAdminFor;

  /** The admin in a directory, or `undefined` when none was created. */
  static readonly read = readLocalAdmin;

  /** The admin in a directory, created first when there is none. */
  static readonly ensure = ensureLocalAdmin;
}
