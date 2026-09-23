import type { ZitadelClient } from "@zitadel/api/client";

import { ZitadelError } from "./errors";

/**
 * The platform's environment-name grammar, from `environment-name.yaml`: a
 * lowercase DNS-style label. Checked before any request so a malformed name
 * fails with the CLI's own message instead of a 400 from the edge.
 */
const ENVIRONMENT_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Longest name the platform accepts, from the same schema. */
const ENVIRONMENT_NAME_MAX = 63;

/** How an owner is named in output: an environment, or the project level. */
export function ownerLabel(environment?: string): string {
  return environment ?? "the project";
}

/** Reject a name the platform would refuse, naming it. */
export function assertEnvironmentName(name: string): void {
  if (!ENVIRONMENT_NAME.test(name) || name.length > ENVIRONMENT_NAME_MAX) {
    throw new ZitadelError("E_VALIDATION", `Invalid environment name ${JSON.stringify(name)}.`, {
      hint: "An environment name is a lowercase DNS-style label: letters, digits, and hyphens between them.",
    });
  }
}

/**
 * Every environment of a project, by name, in the platform's order. The list is
 * paginated, so it is drained; a project holds a handful, so this is one call in
 * practice.
 */
export async function listEnvironmentNames(
  client: ZitadelClient,
  projectId: string,
): Promise<string[]> {
  const drain = async (pageToken?: string): Promise<string[]> => {
    const page = await client.listEnvironments({
      project_id: projectId,
      limit: 100,
      page_token: pageToken,
    });
    const names = page.environments.map((environment) => environment.name);
    return page.next_page_token ? [...names, ...(await drain(page.next_page_token))] : names;
  };
  return drain();
}
