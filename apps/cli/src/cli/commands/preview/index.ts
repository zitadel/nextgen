import { Flags } from "@oclif/core";
import { z } from "zod";

import {
  BackendForbiddenError,
  BackendReleaseContentRevokedError,
  OriginService,
  type ZitadelClient,
} from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import { CommandGroups } from "@/cli/commands/groups";
import { type Admitted, type CommandResult, CREDENTIALS, PREVIEW_CREDENTIAL } from "@/cli/core";
import { filled, reads, type Refused } from "@/cli/core/flags";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { prose } from "@/lib/oclif/rendering";
import { PreviewExpiries, PreviewUrls } from "@/lib/preview";
import {
  deployMessage,
  MESSAGE_MAX_LENGTH,
  messageTooLong,
  Publisher,
  PublishConfigInvalidError,
  PublishConnectionSecretLiteralError,
  PublishConnectionVariableKindError,
  PublishConnectionVariableMissingError,
  PublishConnectionVariableSharedError,
} from "@/lib/publish";
import { runsInCi } from "@/lib/telemetry/dimensions/ci-provider";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { Ttl, TtlError } from "@/lib/ttl";
import { warnings } from "@/lib/ui";
import { ServerCommand } from "@/cli/commands/server-command";
import { Previewable } from "@/cli/core/previewable";
import { PreviewCommand } from "@/cli/core";
import { dryRunResult } from "@/cli/core/crud/shared";
import { Telemetered } from "@/cli/telemetry/telemetered";

const CREDENTIAL_REQUIRED_REFUSAL = {
  message: "{credential} is not set",
  hint: "Set {credential} for this build, or drop --strict to skip the preview when it is absent.",
} as const satisfies Refusal;

const NO_URLS_REFUSAL = {
  message: "No preview URLs to deploy to",
  hint: "Pass --origin, or run inside a pull-request build that sets one of: {variables}.",
} as const satisfies Refusal;

const PRIMARY_ORIGIN_REFUSAL = {
  message: "{origins} is a primary origin",
  hint: "Pass the preview URLs with --origin; production is deployed after merge.",
} as const satisfies Refusal;

/** How a preview is refused when its content builds back to a revoked release. */
const RELEASE_REVOKED_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "A revoked release can never be served again. Change the configuration so it builds a new release.",
  details: {
    release_id: "{release_id}",
    content_hash: "{content_hash}",
  },
} as const satisfies Refusal;

/** How a configuration with errors is refused. */
const CONFIG_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Fix the files named above and rerun; no changes were made.",
} as const satisfies Refusal;

/** How a connection that holds its secret itself is refused. */
const SECRET_LITERAL_REFUSAL = {
  message: "{message}",
  hint: 'Publish a secret with the command below and reference it as "${{ NAME }}".',
  next: [
    {
      id: "variable:set",
      args: {
        name: "NAME",
      },
      flags: {
        secret: true,
      },
    },
  ],
} as const satisfies Refusal;

/** How a connection whose client id and secret name one variable is refused. */
const VARIABLE_SHARED_REFUSAL = {
  message: "{message}",
  hint: "Give each its own variable: a plain one for the client id, a secret one for the client secret.",
} as const satisfies Refusal;

/** How a connection that names a variable the project does not have is refused. */
const VARIABLE_MISSING_REFUSAL = {
  code: "E_CREDENTIAL_MISSING",
  message: "{message}",
  hint: "Publish it with the command below, then deploy again.",
  next: ["{set}"],
} as const satisfies Refusal;

/** How a connection that names a variable of the wrong kind is refused. */
const VARIABLE_KIND_REFUSAL = {
  message: "{message}",
  hint: "{hint}",
  next: ["{set}"],
} as const satisfies Refusal;

/** The shortest and longest a preview may live, as the server fixes them. */
const TTL_MINIMUM_MS = 60 * 1000;
const TTL_MAXIMUM_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * A preview URL as `--origin` names it. An origin has no path, so a trailing
 * slash is dropped and one preview is one spelling. It refuses a blank value
 * and `primary`, the deployment keyword for every primary origin, which a
 * preview build must never reach with its narrower credential.
 */
const ORIGIN = {
  schema: filled
    .transform((origin) => {
      return origin.replace(/\/+$/, "");
    })
    .refine((origin) => {
      return origin !== "primary";
    }, "A preview cannot target the primary origins"),
  refusal: {
    message: "{problem}",
    hint: "Pass the preview URLs with --origin; production is deployed after merge.",
  },
} as const satisfies Refused<string>;

/**
 * How long a preview stays live, as `7d`, `12h` or `90m`. A value that is not
 * a duration is refused as `E_VALIDATION` with `Ttl`'s own message and hint;
 * the schema refuses one outside the server's fixed limits of a minute and
 * 365 days.
 */
const TTL = {
  schema: z
    .string()
    .transform((input) => {
      try {
        return Ttl.parse(input);
      } catch (error) {
        if (error instanceof TtlError) {
          throw new ZitadelError("E_VALIDATION", error.message, { hint: error.hint });
        }
        throw error;
      }
    })
    .refine((ttl) => {
      return ttl.ms >= TTL_MINIMUM_MS && ttl.ms <= TTL_MAXIMUM_MS;
    }),
  refusal: {
    message: "{value} is outside the allowed range",
    hint: "A preview lives between 60s and 365d.",
  },
} as const satisfies Refused<Ttl>;

/**
 * What `-m/--message` records on the release this publishes. It refuses a blank
 * message, which would record nothing, and one longer than the server records,
 * which the server would reject after the bundle was built. `messageTooLong`
 * counts code points, as the server does, so the length is its call and not the
 * schema's. The message is trimmed.
 */
const MESSAGE = {
  schema: z
    .string()
    .trim()
    .min(1, "the value is empty")
    .refine((message) => {
      return !messageTooLong(message);
    }, `the message is longer than ${MESSAGE_MAX_LENGTH} characters`),
  refusal: {
    message: "{problem}",
    hint: "Pass a shorter summary with -m.",
    details: {
      argument: "--message",
    },
  },
} as const satisfies Refused<string>;

/** Why a preview is skipped, or refused, instead of deployed. */
export type PreviewVerdict =
  | "preview"
  | "production-build"
  | "unnamed-ci-build"
  | "no-credential"
  | "credential-required";

/**
 * Whether this build has a preview to deploy. Only a preview or development
 * build does: a production build serves the release `zitadel deploy` published
 * after merge. The environment gates this, not `--origin`, which only selects
 * the targets and never authorizes a preview deploy into an environment that
 * must not take writes. In a CI build `development` is only a platform the
 * resolver cannot read, so it is skipped rather than taken for a preview. A
 * fork pull-request build cannot read the preview credential, so a missing one
 * skips the preview and the build carries on; `--strict` refuses
 * instead, for a trusted build that expects it.
 */
export function previewVerdict(input: {
  environment: string;
  fromDefault: boolean;
  ci: boolean;
  credentialSet: boolean;
  strict: boolean;
}): PreviewVerdict {
  if (input.environment !== "preview" && input.environment !== "development") {
    return "production-build";
  }
  if (input.fromDefault && input.ci) {
    return "unnamed-ci-build";
  }
  if (input.credentialSet) {
    return "preview";
  }
  return input.strict ? "credential-required" : "no-credential";
}

/**
 * The preview URLs to deploy to: `--origin`, each given once as the request's
 * unique targets require, else the ones the platform's own build variables
 * name. None of either is a refusal naming the variables it looked for.
 */
export function readPreviewUrls(
  requested: readonly string[],
  env: NodeJS.ProcessEnv,
): readonly string[] {
  const unique = [...new Set(requested)];
  if (unique.length > 0) {
    return unique;
  }
  const found = PreviewUrls.from(env);
  if (found.urls.length === 0) {
    throw refusalError(NO_URLS_REFUSAL, {
      variables: found.variablesLookedFor.join(", "),
    });
  }
  return [...found.urls];
}

/**
 * Refuses a preview URL that is a primary origin: an exact primary origin is
 * production as surely as the `primary` keyword is. The server is the authority
 * on what the preview token may reach; this catches the mistake before anything
 * is built, whenever the token can read the project's origins. A token that
 * may not read the project (403) leaves the server to decide what it can
 * deploy to. A 401 is a token the server does not accept at all, which fails
 * here rather than after the whole bundle is built.
 */
export async function refusePrimaryOrigins(
  urls: readonly string[],
  client: ZitadelClient,
  projectId: string,
): Promise<void> {
  const originService = new OriginService(client, projectId);
  try {
    const production = await originService.primaryAmong(urls);
    if (production.length > 0) {
      throw refusalError(PRIMARY_ORIGIN_REFUSAL, {
        origins: production.join(", "),
      });
    }
  } catch (error) {
    if (error instanceof BackendForbiddenError) {
      return;
    }
    throw error;
  }
}

/**
 * `zitadel preview` — publish `.zitadel/` to a pull-request build's preview URLs.
 *
 * It is `deploy`'s counterpart for a preview environment: it assembles the same
 * release bundle and validates it as `deploy` does, identity-provider
 * connections included, but never writes them — a pull-request build must not
 * touch the live connections a merged deploy syncs — and deploys to the preview URLs with a time-to-live rather than to the
 * primary origins. The URLs come from `--origin` or, failing that, from the
 * hosting platform's own build variables (Vercel, Netlify).
 *
 * It authenticates with the narrower preview credential and never falls back
 * to the project secret. A fork pull-request build has no `ZITADEL_PREVIEW_TOKEN`
 * — the secret is not shared with forks — so a missing one warns and exits
 * cleanly rather than failing the build; `--strict` turns that warning
 * into a failure for a trusted build that expects the token. Outside a preview
 * or development environment there is nothing to preview — even with an explicit
 * `--origin` — so it says so and exits cleanly without writing. The last line it
 * prints is the release digest as `NEXT_PUBLIC_ZITADEL_RELEASE`, for the build
 * to pin.
 */
export default class Preview extends Telemetered(Previewable(ServerCommand(PreviewCommand))) {
  static override description =
    "Deploy a release from .zitadel/ to a pull-request build's preview URLs.";
  static override group = CommandGroups.releases;
  static override groupOrder = 2;

  static override examples = [
    "<%= config.bin %> preview",
    "<%= config.bin %> preview --origin https://acme-git-sso-acmeinc.vercel.app",
    "<%= config.bin %> preview --ttl 24h",
    "<%= config.bin %> preview -m 'add phone_number to human-user'",
  ];
  static override flags = {
    origin: Flags.custom<string>({
      parse: reads(ORIGIN),
    })({
      description:
        "A preview URL to deploy to, instead of detecting them from the platform build. Repeatable.",
      multiple: true,
    }),
    ttl: Flags.custom<Ttl>({
      parse: reads(TTL),
    })({
      description:
        "How long the preview stays live, such as 7d, 12h or 90m. Between 60s and 365d. Defaults to the project's own lifetime.",
    }),
    message: Flags.custom<string>({
      char: "m",
      parse: reads(MESSAGE),
    })({
      description:
        "A short summary of what this release changes. Defaults to the pull request's title or the current commit's subject.",
    }),
    strict: Flags.boolean({
      description: `Fail instead of warning when no preview credential (${CREDENTIALS[PREVIEW_CREDENTIAL]}) is set.`,
    }),
  };

  /**
   * Says what the command would publish, without publishing it.
   *
   * A dry run validates and resolves the targets but writes nothing (no
   * release, no deployment, no preview registration), so a pull-request build
   * can check its `.zitadel/` without publishing, as `deploy --dry-run` does.
   *
   * @param input.flags - The flags the command accepts.
   * @returns The result of the dry run.
   */
  protected async preview({ flags }: Admitted<typeof Preview>): Promise<CommandResult> {
    const skipped = this.skippedUnlessPreviewable(flags.strict);
    if (skipped !== undefined) {
      return skipped;
    }
    const { urls, publisher } = await this.connected(flags);
    const prepared = await this.prepare(publisher, {
      cwd: this.cwd,
      env: this.env,
      mode: "preview",
      dryRun: true,
      compare: false,
    });
    for (const warning of prepared.warnings) {
      warnings.report(warning);
    }
    this.narrate(prepared.notices);

    const dryRun = dryRunResult({
      verb: "deploy",
      topic: "preview",
      noun: `the preview to ${urls.length} ${new Intl.PluralRules("en").select(urls.length) === "one" ? "URL" : "URLs"}`,
      next: this.suggest({
        id: "preview",
        flags: {
          origin: [...urls],
          ttl: flags.ttl?.canonical,
          message: flags.message,
          strict: flags.strict,
        },
      }),
    });

    return {
      ...dryRun,
      pretty: prose(
        [
          dryRun.summary.title,
          ...urls.map((url) => {
            return `  - ${url}`;
          }),
        ].join("\n"),
      ),
      data: { ...(dryRun.data as object), targets: urls },
      summary: {
        ...dryRun.summary,
        lines: urls.map((url) => {
          return `  - ${escapeControlCharacters(url)}`;
        }),
      },
    };
  }

  /**
   * Publishes the preview.
   *
   * The IdP step validates the connection files and stops short of syncing them
   * in a preview, so a pull-request build never reconfigures the connections a
   * merged deploy owns. The release keeps the message of whichever run built
   * it first, usually this one, so the deploy after merge reuses it rather than
   * adding its own. The wire takes an ISO-8601 duration, while `--ttl` keeps
   * the `7d`/`12h` spelling a person writes (create-deployment-request.yaml).
   *
   * @param input.flags - The flags the command accepts.
   * @returns The result of the run.
   */
  protected async apply({ flags }: Admitted<typeof Preview>): Promise<CommandResult> {
    const skipped = this.skippedUnlessPreviewable(flags.strict);
    if (skipped !== undefined) {
      return skipped;
    }
    const { urls, client, projectId, publisher } = await this.connected(flags);
    const prepared = await this.prepare(publisher, {
      cwd: this.cwd,
      env: this.env,
      mode: "preview",
      dryRun: false,
      compare: false,
    });
    for (const warning of prepared.warnings) {
      warnings.report(warning);
    }
    this.narrate(prepared.notices);

    const message = await deployMessage(flags.message, this.cwd, this.env);
    try {
      const { release, deployment } = await publisher.preview({
        prepared,
        message,
        urls,
        ...(flags.ttl === undefined
          ? {}
          : {
              ttl: flags.ttl.iso,
            }),
      });

      const expiries = await PreviewExpiries.of(client, projectId).live(
        deployment.targets.map((target) => {
          return target.origin;
        }),
      );
      const previews = deployment.targets.map((target) => {
        return {
          url: target.origin,
          expires_at: expiries.get(target.origin) ?? null,
        };
      });

      const previewUrls = `${previews.length} ${new Intl.PluralRules("en").select(previews.length) === "one" ? "URL" : "URLs"}`;

      const title = `Previewed ${escapeControlCharacters(release.content_hash)} on ${previewUrls}`;

      return {
        status: "ok",
        data: {
          title,
          release_id: release.id,
          content_hash: release.content_hash,
          deployment_id: deployment.id,
          previews,
          release_env: `NEXT_PUBLIC_ZITADEL_RELEASE=${release.content_hash}`,
        },
        pretty: prose(
          [
            `Previewed ${release.content_hash} on ${previewUrls}`,
            ...previews.map((preview) => {
              return preview.expires_at === null
                ? `  - ${preview.url}`
                : `  - ${preview.url} (until ${preview.expires_at})`;
            }),
            `NEXT_PUBLIC_ZITADEL_RELEASE=${release.content_hash}`,
          ].join("\n"),
        ),
        summary: {
          title,
          sections: [],
          lines: [
            ...previews.map((preview) => {
              return preview.expires_at === null
                ? `  - ${escapeControlCharacters(preview.url)}`
                : `  - ${escapeControlCharacters(preview.url)} (until ${escapeControlCharacters(preview.expires_at)})`;
            }),
            `NEXT_PUBLIC_ZITADEL_RELEASE=${escapeControlCharacters(release.content_hash)}`,
          ],
        },
      };
    } catch (error) {
      if (error instanceof BackendReleaseContentRevokedError) {
        throw refusalError(RELEASE_REVOKED_REFUSAL, {
          ...error,
          message: error.message,
          release_id: error.releaseId,
          content_hash: error.contentHash,
        });
      }
      throw error;
    }
  }

  /**
   * Why this build previews nothing, as the result it answers with, or
   * `undefined` when it does. A build outside a preview environment has nothing
   * to preview, and one without the preview credential — a fork's, which cannot
   * read it — warns and exits cleanly unless `--strict` asks to fail.
   */
  private skippedUnlessPreviewable(strict: boolean): CommandResult | undefined {
    const credential = CREDENTIALS[PREVIEW_CREDENTIAL];
    const verdict = previewVerdict({
      environment: this.environment.name.value,
      fromDefault: this.environment.name.source === "default",
      ci: runsInCi(this.env),
      credentialSet: this.environment.values[credential] !== undefined,
      strict,
    });
    switch (verdict) {
      case "preview": {
        return undefined;
      }
      case "credential-required": {
        throw refusalError(CREDENTIAL_REQUIRED_REFUSAL, {
          credential,
        });
      }
      case "production-build": {
        return {
          status: "skipped",
          reason: "nothing-to-preview",
          summary: {
            title: "Nothing to preview: production is deployed after merge",
            sections: [],
          },
        };
      }
      case "unnamed-ci-build": {
        warnings.report(
          "This CI build names no environment, so the preview is skipped. Set ZITADEL_ENV=preview in the pull-request build that should deploy one.",
        );
        return {
          status: "skipped",
          reason: "nothing-to-preview",
          summary: {
            title: "Nothing to preview: set ZITADEL_ENV=preview in the pull-request build",
            sections: [],
          },
        };
      }
      case "no-credential": {
        warnings.report(
          `No preview credential (${credential}) is set, so the preview is skipped; a fork pull-request build cannot read it. Pass --strict to fail instead.`,
        );
        return {
          status: "skipped",
          reason: "no-preview-credential",
          summary: {
            title: `Preview skipped: no preview credential (${escapeControlCharacters(credential)})`,
            sections: [],
          },
        };
      }
    }
  }

  /**
   * Prepares what is published, refusing a configuration that cannot be
   * published and saying how to fix it.
   *
   * @param publisher - The publisher.
   * @param input - What to prepare.
   * @returns What was prepared.
   * @throws {@link ZitadelError} The refusal for the condition publishing stopped on; an
   *   error nobody anticipated is thrown as it was.
   */
  private async prepare(publisher: Publisher, input: Parameters<Publisher["prepare"]>[0]) {
    try {
      return await publisher.prepare(input);
    } catch (error) {
      if (error instanceof PublishConnectionSecretLiteralError) {
        throw refusalError(SECRET_LITERAL_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof PublishConnectionVariableSharedError) {
        throw refusalError(VARIABLE_SHARED_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof PublishConnectionVariableMissingError) {
        throw refusalError(
          VARIABLE_MISSING_REFUSAL,
          {
            ...error,
            message: error.message,
          },
          {
            set: {
              id: "variable:set",
              args: {
                name: error.variable,
              },
              flags: {
                secret: error.secret,
                preview: input.mode === "preview",
              },
            },
          },
        );
      }
      if (error instanceof PublishConnectionVariableKindError) {
        throw refusalError(
          VARIABLE_KIND_REFUSAL,
          {
            ...error,
            message: error.message,
            hint: error.secret
              ? "The client secret must be a secret variable: publish it with the command below."
              : "The client id must be a plain variable the engine can read back: publish it with the command below, without --secret.",
          },
          {
            set: {
              id: "variable:set",
              args: {
                name: error.variable,
              },
              flags: {
                secret: error.secret,
                preview: input.mode === "preview",
              },
            },
          },
        );
      }
      if (error instanceof PublishConfigInvalidError) {
        throw refusalError(CONFIG_INVALID_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      throw error;
    }
  }

  /**
   * Reads and checks what both a dry run and a publish start from: the URLs
   * to preview, the connection, and a refusal of the primary origins.
   *
   * @param flags - The flags the command accepts.
   * @returns The URLs, the connection and a publisher on it.
   */
  private async connected(flags: Admitted<typeof Preview>["flags"]) {
    const urls = readPreviewUrls(flags.origin ?? [], this.env);
    const { client, projectId } = await this.connect();
    await refusePrimaryOrigins(urls, client, projectId);

    return {
      urls,
      client,
      projectId,
      publisher: new Publisher(client, projectId),
    };
  }
}
