import { issuerFromPort, type FrameworkFacts, type Orca } from "../../lib/orca";
import type { PatchContext } from "../../lib/orca/patchers/types";
import {
  readDevelopmentIssuer,
  readPreset,
  readRendererId,
  readUseCase,
  readZitadelConfig,
  readZitadelSecret,
} from "../../lib/project";
import { readScaffoldManifest } from "../../lib/scaffold-manifest";

/**
 * Reconstructs a {@link PatchContext} from the on-disk project (config,
 * secret, scaffold manifest) plus fresh framework detection, so a patcher
 * repair can rebuild its plan. Used by the doctor checks' `fix` paths.
 * `preset`/`useCase` come back from `zitadel.json` and
 * `scaffoldedFramework` from the scaffold manifest, so the rebuilt plan
 * matches what setup originally emitted (a fresh-scaffolded app's home page
 * is part of the plan again, for example). Schema and flow config are
 * user-editable sync resources, not patcher inputs, so nothing here reads
 * them.
 */
export async function loadPatchContext(
  cwd: string,
  orca: Orca,
  cliVersion: string,
): Promise<PatchContext> {
  const config = await readZitadelConfig(cwd);
  const secret = await readZitadelSecret(cwd);
  const framework = await orca.detect(cwd);
  const scaffold = await readScaffoldManifest(cwd);
  return {
    framework,
    rendererId: readRendererId(config),
    issuer: await resolveIssuer(cwd, config, framework),
    server: typeof config.server === "string" ? config.server : "",
    cliVersion,
    scaffoldedFramework: scaffold?.scaffolded_framework,
    preset: readPreset(config),
    useCase: readUseCase(config),
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
  const scaffold = await readScaffoldManifest(cwd);
  if (typeof scaffold?.dev_port === "number") {
    return issuerFromPort(scaffold.dev_port);
  }
  return facts.url;
}
