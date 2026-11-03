import { findLocalAdminDir, readLocalAdmin } from "../../../lib/local-server/admin-credential";
import { DEFAULT_LOCAL_SERVER_URL, readRuntimeMetadata } from "../../../lib/local-server/runtime";
import { requirement } from "../../../lib/oclif/requirements";

/**
 * The local admin `zitadel start` created. `start` may have run in a parent of
 * the app directory, and its runtime metadata sits beside the admin it
 * created, so both are read from there. Refuses a directory with no admin. The
 * run is about that server.
 */
export const localAdmin = requirement({
  refusal: {
    message: "No local admin in this directory or its parents",
    hint: "Run this from the directory `zitadel start` ran in, or one inside it. If the server was never started, run `zitadel start` first; it creates the local admin the console signs in as.",
    next: ["start"],
  },
  resolve: async ({ meta }) => {
    const dir = (await findLocalAdminDir(meta.cwd)) ?? meta.cwd;
    const admin = await readLocalAdmin(dir);
    if (admin === undefined) {
      return undefined;
    }
    return {
      admin,
      dir,
      runtime: await readRuntimeMetadata(dir),
    };
  },
  source: ({ runtime }) => {
    return runtime?.server_url ?? DEFAULT_LOCAL_SERVER_URL;
  },
});
