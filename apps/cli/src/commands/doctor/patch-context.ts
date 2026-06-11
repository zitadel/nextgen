import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { issuerFromPort, type FrameworkFacts, type Orca } from "../../lib/orca";
import type { PatchContext } from "../../lib/orca/patchers/types";
import { readDevelopmentIssuer, readRendererId, readZitadelConfig, readZitadelSecret } from "../../lib/project";

/**
 * Reconstructs a {@link PatchContext} from the on-disk project (config, secret)
 * plus fresh framework detection, so a patcher repair can rebuild its plan.
 * Used by the dependency check's `fix`, which reclaims the framework-specific
 * SDK package via `patcher.repair`. The user schema and flow definition are
 * server-owned and no longer scaffolded locally, so nothing here reads them.
 */
export async function loadPatchContext(
  cwd: string,
  orca: Orca,
  cliVersion: string,
  dependencyVersions?: Readonly<Record<string, string>>,
): Promise<PatchContext> {
  const config = await readZitadelConfig(cwd);
  const secret = await readZitadelSecret(cwd);
  const framework = await orca.detect(cwd);
  return {
    framework,
    rendererId: readRendererId(config),
    issuer: await resolveIssuer(cwd, config, framework),
    server: typeof config.server === "string" ? config.server : "",
    cliVersion,
    dependencyVersions,
    project: {
      id: secret.project_id,
      projectSecret: secret.project_secret,
      previewSecret: secret.preview_secret,
      previewOrigins: secret.preview_origins,
      createdAt: secret.created_at,
    },
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
  return facts.url;
}

async function readState(cwd: string): Promise<{ dev_port?: number } | undefined> {
  try {
    const contents = await readFile(join(cwd, ".zitadel/state.json"), "utf8");
    return JSON.parse(contents) as { dev_port?: number };
  } catch {
    return undefined;
  }
}
