import { readZitadelSecret, type ZitadelSecret } from "../../../lib/project";
import { requirement } from "../../../lib/oclif/requirements";
import type { Chosen } from "./operation";

/** The project the operation is called on behalf of, when there is one. */
export type ProjectSecret = Readonly<{
  secret: ZitadelSecret | undefined;
}>;

/**
 * An operation that needs no credential runs anywhere; one that does needs the
 * project `zitadel setup` wrote, and is refused without it. Either way a
 * project at hand fills a `project_id` left out. With the operation still to be
 * chosen, a missing project only narrows what can be chosen.
 */
async function projectSecretFor(chosen: Chosen, cwd: string): Promise<ZitadelSecret | undefined> {
  if (chosen.target?.operation.auth === "secret") {
    return readZitadelSecret(cwd);
  }
  return readZitadelSecret(cwd).catch(() => undefined);
}

export const apiSecret = requirement<ProjectSecret>({
  resolve: async ({ meta, resolved }) => ({
    secret: await projectSecretFor(resolved.operation as Chosen, meta.cwd),
  }),
});
