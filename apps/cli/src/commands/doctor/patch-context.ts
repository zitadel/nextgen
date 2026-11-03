import { resolveEnvironment } from "../../lib/environment";
import { issuerFromPort, type FrameworkFacts, type Orca } from "../../lib/orca";
import type { PatchContext } from "../../lib/orca/patchers/types";
import {
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
    issuer: await resolveIssuer(cwd, framework),
    server: typeof config.server === "string" ? config.server : "",
    cliVersion,
    scaffoldedFramework: scaffold?.scaffolded_framework,
    // Restore the posture setup recorded rather than re-deriving it — a
    // manifest-less legacy scaffold cannot answer the fresh-vs-pre-existing
    // hinge, and every scaffold before the record was full-page (ADR 044).
    posture: scaffold?.posture ?? "page",
    preset: readPreset(config),
    useCase: readUseCase(config),
    project: {
      id: secret.project_id,
      project_secret: secret.project_secret,
      preview_secret: secret.preview_secret,
      origins: [
        ...(secret.primary_origins ?? []).map((pattern) => ({
          pattern,
          kind: "primary" as const,
        })),
        ...secret.preview_origins.map((pattern) => ({
          pattern,
          kind: "preview" as const,
        })),
      ],
      created_at: secret.created_at,
    },
  };
}

/**
 * The issuer setup recorded for the development project (`ZITADEL_ISSUER`),
 * from its files alone: the repair writes it into `.env.local` and
 * `.env.development.local`, so a production issuer exported in the shell, or a
 * `ZITADEL_ENV` naming another environment, must never stand in for it.
 * `undefined` when no file sets it, or one the resolver cannot read.
 */
export async function configuredIssuer(cwd: string): Promise<string | undefined> {
  return resolveEnvironment({ cwd, env: {} }).then(
    ({ values }) => values.ZITADEL_ISSUER?.value,
    () => undefined,
  );
}

async function resolveIssuer(cwd: string, facts: FrameworkFacts): Promise<string> {
  // A file the resolver cannot read leaves the issuer to the fallbacks below
  // rather than failing the repair.
  const issuer = await configuredIssuer(cwd);
  if (issuer !== undefined) {
    return issuer;
  }
  const scaffold = await readScaffoldManifest(cwd);
  if (typeof scaffold?.dev_port === "number") {
    return issuerFromPort(scaffold.dev_port);
  }
  return facts.url;
}
