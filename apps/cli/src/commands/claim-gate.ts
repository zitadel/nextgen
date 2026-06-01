import { ZitadelError } from "../lib/errors";
import type { PlatformClient } from "../platform/client";
import type { ZitadelEnvironment } from "../platform/schemas";

export async function ensureClaimedForEnvironment(
  client: PlatformClient,
  projectId: string,
  environment: ZitadelEnvironment,
): Promise<void> {
  if (environment === "development") return;

  const project = await client.getProject(projectId);
  if (project.lifecycle === "claimed") return;

  if (project.claim_required_for.includes(environment)) {
    throw new ZitadelError(
      "E_CLAIM_REQUIRED",
      `Project ${projectId} must be claimed before using ${environment}.`,
      {
        hint: "Run `zitadel claim`, complete the browser flow, then retry this command.",
        nextCommands: ["zitadel claim"],
        details: {
          project_id: projectId,
          environment,
          lifecycle: project.lifecycle,
          claim_required_for: project.claim_required_for,
        },
      },
    );
  }
}
