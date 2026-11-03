import type { ProjectOrigin } from "../../../lib/origins";
import { readZitadelSecret } from "../../../lib/project";
import { requirement, unmet } from "../../../lib/oclif/requirements";
import { missingPrimaryOrigin } from "../missing-primary-origin";

async function setupProjectId(cwd: string): Promise<string | undefined> {
  return readZitadelSecret(cwd).then(
    (secret) => secret.project_id,
    () => undefined,
  );
}

/**
 * The primary origins a deploy lands on. It goes to every primary origin, so
 * the project must have at least one, found before the bundle is built and the
 * IdP connections are synced: a project with none fails before the IdP step
 * does a partial write rather than after it. A dry run writes nothing and
 * never reaches the deploy, so it is exempt.
 */
export const origins = requirement({
  refusal: {
    message: "The project has no primary origin to deploy to",
    hint: "{hint}",
    next: ["{next}"],
  },
  resolve: async ({ meta, connect, suggest }) => {
    if (meta.dryRun) {
      return {
        origins: [] as ReadonlyArray<ProjectOrigin>,
        landing: [] as string[],
      };
    }
    const { client, projectId, environment } = await connect();
    const project = await client.getProject(projectId);
    const origins = project.origins ?? [];
    const landing = origins
      .filter((entry) => entry.kind === "primary")
      .map((entry) => entry.pattern);
    if (landing.length > 0) {
      return {
        origins,
        landing,
      };
    }
    const setupProject = await setupProjectId(meta.cwd);
    return unmet(
      missingPrimaryOrigin({
        origins,
        issuer: environment.values.ZITADEL_ISSUER?.value,
        setupProject: setupProject === projectId,
        suggest,
      }),
    );
  },
});
