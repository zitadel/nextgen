import { configuredIssuer } from "@/commands/doctor/patch-context";
import {
  createZitadelClient,
  DeploymentService,
  OriginService,
  Origins,
  type ZitadelClient,
} from "@/lib/backend";
import { errorMessage, isCancellation } from "@/lib/errors";
import {
  readProjectServer,
  readZitadelConfig,
  readZitadelSecret,
  writeZitadelSecret,
  type ZitadelSecret,
} from "@/lib/project";
import { userAgent } from "@/lib/user-agent";
import { reportWarning } from "@/lib/warnings";

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
    const finding = await inspect(ctx.cwd, ctx.signal);
    if (finding.status === "pass") {
      return {
        name: this.name,
        status: "pass",
        message: finding.message,
        path: this.path,
      };
    }
    return {
      name: this.name,
      status: "warn",
      message:
        `The project has no primary origin to deploy to: it holds ${finding.pattern} as a ` +
        "preview origin, as setup 0.1.0 registered it. Run " +
        `${ctx.suggest("doctor", { flags: { fix: true } })} to make it primary.`,
      details: {
        pattern: finding.pattern,
        server: finding.server,
      },
      path: this.path,
    };
  }

  /**
   * Makes the preview issuer primary on the server, then in `.zitadel/secret`.
   * The API has no kind change, and adding the pattern as primary conflicts
   * with the stored preview one, so it is removed and added back, which takes
   * consent. Should the add fail, the preview pattern is put back: a project
   * left with no origins admits no origin except a loopback origin. A primary
   * origin serves nothing until a deployment names it, so the newest primary
   * release, if there is one, is deployed again to land on it; otherwise a
   * warning says to deploy.
   */
  async fix(ctx: CheckContext): Promise<void> {
    if (ctx.dryRun) {
      return;
    }
    const finding = await inspect(ctx.cwd, ctx.signal);
    if (finding.status === "pass") {
      return;
    }
    const { client, pattern, secret, server } = finding;
    const consent = await ctx.consent({
      verb: "replace",
      name: `replace the preview origin ${pattern} with a primary one`,
      message: `Replace the preview origin ${pattern} with a primary one in project ${secret.project_id} on ${server.replace(/^https?:\/\//, "")}?`,
    });
    if (consent === undefined) {
      return;
    }
    const originService = new OriginService(consent.unlock(client), secret.project_id);
    await originService.promote(pattern);
    await writeZitadelSecret(ctx.cwd, {
      ...secret,
      primary_origins: [...secret.primary_origins, pattern],
      preview_origins: secret.preview_origins.filter((recorded) => {
        return recorded !== pattern;
      }),
    });
    const extended = await new DeploymentService(client, secret.project_id)
      .extendPrimary(pattern, `Made ${pattern} a primary origin`)
      .catch((error: unknown) => {
        if (isCancellation(error)) {
          throw error;
        }
        return undefined;
      });
    if (extended?.outcome !== "deployed" && extended?.outcome !== "unchanged") {
      reportWarning(
        `${pattern} is a primary origin now, but it serves nothing until a deployment names it: deploy in the app.`,
      );
    }
  }
}

async function inspect(cwd: string, signal: AbortSignal): Promise<Finding> {
  const records = await readZitadelSecret(cwd)
    .then(async (secret) => {
      return {
        secret,
        server: readProjectServer(await readZitadelConfig(cwd)),
      };
    })
    .catch(() => {
      return undefined;
    });
  if (records === undefined) {
    // A missing or unparseable secret or config is the `secret` and `config`
    // checks' to report, with a repair path.
    return {
      status: "pass",
      message: "Skipped: could not read the project files that record its origins",
    };
  }
  const { secret, server } = records;
  const issuer = await configuredIssuer(cwd);
  if (issuer === undefined) {
    return {
      status: "pass",
      message: "Skipped: no file sets ZITADEL_ISSUER",
    };
  }
  const recorded = Origins.wrap([
    ...secret.primary_origins.map((pattern) => {
      return {
        pattern,
        kind: "primary",
      };
    }),
    ...secret.preview_origins.map((pattern) => {
      return {
        pattern,
        kind: "preview",
      };
    }),
  ]);
  if (recorded.heldAsPreview(issuer) === undefined) {
    return {
      status: "pass",
      message: `${issuer} is not recorded as a preview origin`,
    };
  }

  const client = createZitadelClient({
    userAgent: userAgent(),
    baseUrl: server,
    token: secret.project_secret,
    signal,
  });
  const originService = new OriginService(client, secret.project_id);
  const read = await originService
    .list()
    .then((origins) => {
      return { origins };
    })
    .catch((error: unknown) => {
      // Cancelling is not a check that could not read: the person asked
      // `doctor` to stop, so it stops rather than passing a check it skipped.
      if (isCancellation(error)) {
        throw error;
      }
      return { failure: error };
    });
  if ("failure" in read) {
    return {
      status: "pass",
      message: `Skipped: could not read the project's origins from ${server}: ${errorMessage(read.failure)}`,
    };
  }
  const { origins } = read;
  const pattern = origins.heldAsPreview(issuer);
  if (pattern !== undefined) {
    return {
      status: "warn",
      pattern,
      server,
      secret,
      client,
    };
  }
  return {
    status: "pass",
    message:
      origins.primary.length > 0
        ? "The project has a primary origin to deploy to"
        : `${issuer} is not a preview origin of the project`,
  };
}
