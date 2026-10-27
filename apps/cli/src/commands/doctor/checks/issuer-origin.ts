import { createZitadelClient, type ZitadelClient } from "../../../lib/api-client";
import { issuerHeldAsPreview, recordedOrigins } from "../../../lib/origins";
import {
  readProjectServer,
  readZitadelConfig,
  readZitadelSecret,
  writeZitadelSecret,
  type ZitadelSecret,
} from "../../../lib/project";
import { configuredIssuer } from "../patch-context";
import type { CheckContext, CheckOutcome, SanityCheck } from "./types";

/** What {@link inspect} found: a pass, or the preview issuer `fix` makes primary. */
type Finding =
  | { readonly status: "pass"; readonly message: string }
  | {
      readonly status: "warn";
      readonly pattern: string;
      readonly server: string;
      readonly secret: ZitadelSecret;
      readonly client: ZitadelClient;
    };

/**
 * Warns when the project has no primary origin but holds its issuer
 * (`ZITADEL_ISSUER`, the URL setup registers) as a preview origin, the way
 * `zitadel setup` 0.1.0 registered it. `deploy` lands only on primary origins,
 * so such a project cannot deploy, and `origin add --kind primary` refuses the
 * stored pattern. `--fix` makes it primary.
 *
 * It asks the server only when `.zitadel/secret` records the issuer that way,
 * as 0.1.0 wrote it, so doctor makes no request for any other project. The
 * project is the one `.zitadel/secret` names, on the server `zitadel.json`
 * names: doctor pins its own source to the local runtime URL.
 *
 * Implements {@link SanityCheck} directly, as `ClaimCheck` does: it is only
 * ever warn or pass. A server it cannot reach skips it, since doctor carries on
 * past a probe that fails.
 */
export class IssuerOriginCheck implements SanityCheck {
  readonly name = "issuer-origin";
  readonly path = ".zitadel/secret";

  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const finding = await inspect(ctx.cwd);
    if (finding.status === "pass") {
      return { name: this.name, status: "pass", message: finding.message, path: this.path };
    }
    return {
      name: this.name,
      status: "warn",
      message:
        `The project has no primary origin to deploy to: it holds ${finding.pattern} as a ` +
        "preview origin, as setup 0.1.0 registered it. Run doctor --fix " +
        "to make it primary.",
      details: { pattern: finding.pattern, server: finding.server },
      path: this.path,
    };
  }

  /**
   * Makes the preview issuer primary on the server, then in `.zitadel/secret`.
   * The API has no kind change, and adding the pattern as primary conflicts
   * with the stored preview one, so it is removed and added back. Should the
   * add fail, the preview pattern is put back: a project left with no origins
   * admits every origin.
   */
  async fix(ctx: CheckContext): Promise<void> {
    if (ctx.dryRun) {
      return;
    }
    const finding = await inspect(ctx.cwd);
    if (finding.status === "pass") {
      return;
    }
    const { client, pattern, secret } = finding;
    await client.removeOrigin(secret.project_id, { pattern });
    try {
      await client.addOrigin(secret.project_id, { pattern, kind: "primary" });
    } catch (error) {
      await client
        .addOrigin(secret.project_id, { pattern, kind: "preview" })
        .catch(() => undefined);
      throw error;
    }
    await writeZitadelSecret(ctx.cwd, {
      ...secret,
      primary_origins: [...secret.primary_origins, pattern],
      preview_origins: secret.preview_origins.filter((recorded) => recorded !== pattern),
    });
  }
}

async function inspect(cwd: string): Promise<Finding> {
  let secret: ZitadelSecret;
  let server: string;
  try {
    secret = await readZitadelSecret(cwd);
    server = readProjectServer(await readZitadelConfig(cwd));
  } catch {
    // A missing or unparseable secret or config is the `secret` and `config`
    // checks' to report, with a repair path.
    return {
      status: "pass",
      message: "Skipped: could not read the project files that record its origins",
    };
  }
  const issuer = await configuredIssuer(cwd);
  if (issuer === undefined) {
    return { status: "pass", message: "Skipped: no file sets ZITADEL_ISSUER" };
  }
  if (issuerHeldAsPreview(recordedOrigins(secret), issuer) === undefined) {
    return { status: "pass", message: `${issuer} is not recorded as a preview origin` };
  }

  const client = createZitadelClient({ baseUrl: server, token: secret.project_secret });
  let origins: ReadonlyArray<{ pattern: string; kind: string }>;
  try {
    origins = (await client.getProject(secret.project_id)).origins ?? [];
  } catch (error) {
    return {
      status: "pass",
      message: `Skipped: could not read the project's origins from ${server}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const pattern = issuerHeldAsPreview(origins, issuer);
  if (pattern !== undefined) {
    return { status: "warn", pattern, server, secret, client };
  }
  return {
    status: "pass",
    message: origins.some((origin) => origin.kind === "primary")
      ? "The project has a primary origin to deploy to"
      : `${issuer} is not a preview origin of the project`,
  };
}
