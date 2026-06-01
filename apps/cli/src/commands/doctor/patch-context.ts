import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CreateSchemaBody } from "@zitadel-nextgen/api/generated/model";

import { isObject } from "../../lib/json";
import { issuerFromPort, type FrameworkFacts, type Orca } from "../../lib/orca";
import type { PatchContext } from "../../lib/orca/patchers/types";
import { readDevelopmentIssuer, readRendererId, readZitadelConfig, readZitadelSecret } from "../../lib/project";

/**
 * Reconstructs a {@link PatchContext} from the on-disk project (config, secret,
 * user schema) plus fresh framework detection, so a patcher repair can rebuild
 * its plan. The user-schema property names are read back from disk; only
 * `.zitadel/` resource contents depend on them, and a repair filters those out
 * anyway. Used by the dependency check's `fix`, which reclaims the
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
    userSchema: raw as CreateSchemaBody,
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
