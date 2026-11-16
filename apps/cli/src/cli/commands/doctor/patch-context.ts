import { join } from "node:path";
import { parseEnv } from "node:util";

import { Environment } from "@/lib/environment";
import { readIfReadable } from "@/lib/fs";
import { type FrameworkFacts, issuerFromPort, Orca } from "@/lib/orca";
import type { PatchContext } from "@/lib/orca/patchers/types";
import { Project } from "@/lib/project";
import { CliPackage } from "@/lib/upgrade";

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
  const config = await Project.at(cwd).config();
  const secret = await Project.at(cwd).secret();
  const framework = await orca.detect(cwd);
  const scaffold = await Orca.readManifest(cwd);
  return {
    framework,
    rendererId: config.rendererId,
    issuer: await resolveIssuer(cwd, framework),
    server: typeof config.data.server === "string" ? config.data.server : "",
    cliVersion,
    sdkVersion: CliPackage.at(cliVersion).selector(),
    scaffoldedFramework: scaffold?.scaffolded_framework,
    // Restore the posture setup recorded: a manifest-less scaffold cannot answer
    // the fresh-vs-pre-existing hinge, and it is always full-page (ADR 044).
    posture: scaffold?.posture ?? "page",
    preset: config.preset,
    useCase: config.useCase,
    developmentServerUrl: await developmentServerUrl(cwd),
    project: {
      id: secret.data.project_id,
      project_secret: secret.data.project_secret,
      preview_secret: secret.data.preview_secret,
      origins: [
        ...(secret.data.primary_origins ?? []).map((pattern) => {
          return {
            pattern,
            kind: "primary" as const,
          };
        }),
        ...secret.data.preview_origins.map((pattern) => {
          return {
            pattern,
            kind: "preview" as const,
          };
        }),
      ],
      created_at: secret.data.created_at,
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
  return Environment.resolve({
    cwd,
    env: {},
  }).then(
    ({ values }) => {
      return values.ZITADEL_ISSUER?.value;
    },
    () => {
      return undefined;
    },
  );
}

async function resolveIssuer(cwd: string, facts: FrameworkFacts): Promise<string> {
  // A file the resolver cannot read leaves the issuer to the fallbacks below
  // rather than failing the repair.
  const issuer = await configuredIssuer(cwd);
  if (issuer !== undefined) {
    return issuer;
  }
  const scaffold = await Orca.readManifest(cwd);
  if (typeof scaffold?.dev_port === "number") {
    return issuerFromPort(scaffold.dev_port);
  }
  return facts.url;
}

/**
 * `ZITADEL_URL` as `.env.development.local` sets it, which the base ops keep
 * and Vite ranks above the other env files; `undefined` when the file does
 * not set it or cannot be read.
 */
async function developmentServerUrl(cwd: string): Promise<string | undefined> {
  const text = await readIfReadable(join(cwd, ".env.development.local"));
  return text === undefined ? undefined : parseEnv(text).ZITADEL_URL;
}
