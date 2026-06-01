import type { ZitadelClient } from "@zitadel-nextgen/api/client";

import { ZitadelError } from "../lib/errors";
import type { ZitadelEnvironment } from "../lib/environment";

export async function ensureClaimedForEnvironment(
  client: ZitadelClient,
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
