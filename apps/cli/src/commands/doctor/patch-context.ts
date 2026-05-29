import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { isAuthMethod } from "../../lib/flows";
import { isObject } from "../../lib/json";
import { issuerFromPort, type FrameworkFacts, type Orca } from "../../lib/orca";
import type { PatchContext } from "../../lib/orca/patchers/types";
import type { UserSchema } from "../../lib/user-schema";
import { readDevelopmentIssuer, readRendererId, readZitadelConfig, readZitadelSecret } from "../../lib/project";

/**
 * Reconstructs a {@link PatchContext} from the on-disk project (config, secret,
 * user schema) plus fresh framework detection, so a patcher repair can rebuild
 * its plan. Auth method and fields are read back from the user schema; their
 * exact values only affect the `.zitadel/` resource contents, which a repair
 * filters out anyway. Used by the dependency check's `fix`, which reclaims the
 * framework-specific SDK package via `patcher.repair`.
 */
export async function loadPatchContext(cwd: string, orca: Orca): Promise<PatchContext> {
  const config = await readZitadelConfig(cwd);
  const secret = await readZitadelSecret(cwd);
  const framework = await orca.detect(cwd);
  const raw = JSON.parse(
    await readFile(join(cwd, ".zitadel/schemas/user.json"), "utf8"),
  ) as Record<string, unknown>;
  const properties = isObject(raw.properties) ? raw.properties : {};
  const authMethods = isObject(raw["x-auth-methods"]) ? raw["x-auth-methods"] : {};
  const recordedMethod = Object.keys(authMethods)[0];
  return {
    framework,
    rendererId: readRendererId(config),
    issuer: await resolveIssuer(cwd, config, framework),
    server: typeof config.server === "string" ? config.server : "",
    project: {
      id: secret.project_id,
      projectSecret: secret.project_secret,
      previewSecret: secret.preview_secret,
      previewOrigins: secret.preview_origins,
      createdAt: secret.created_at,
    },
    userFields: Object.keys(properties),
    authMethod: isAuthMethod(recordedMethod) ? recordedMethod : "passkey",
    userSchema: raw as UserSchema,
  };
}

async function resolveIssuer(
  cwd: string,
  config: Record<string, unknown>,
  facts: FrameworkFacts,
): Promise<string> {
  const fromConfig = readDevelopmentIssuer(config);
  if (fromConfig && fromConfig.length > 0) {
    return fromConfig;
  }
  const state = await readState(cwd);
  if (typeof state?.dev_port === "number") {
    return issuerFromPort(state.dev_port);
  }
  return facts.issuerUrl;
}

async function readState(cwd: string): Promise<{ dev_port?: number } | undefined> {
  try {
    const contents = await readFile(join(cwd, ".zitadel/state.json"), "utf8");
    return JSON.parse(contents) as { dev_port?: number };
  } catch {
    return undefined;
  }
}
