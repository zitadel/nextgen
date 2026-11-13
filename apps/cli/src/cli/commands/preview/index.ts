import { Flags } from "@oclif/core";
import { z } from "zod";

import { ForbiddenError, OriginService, PreviewService, type ZitadelClient } from "@/lib/backend";
import {
  type Admitted,
  CommandGroups,
  type CommandResult,
  CREDENTIALS,
  type JsonEnvelope,
  PREVIEW_CREDENTIAL,
  PreviewCommand,
} from "@/lib/oclif";
import { filled, reads, type Refused } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { prose } from "@/lib/oclif/rendering";
import { detectPreviewUrls } from "@/lib/preview";
import { deployMessage, MESSAGE_MAX_LENGTH, messageTooLong, Publisher } from "@/lib/publish";
import { runsInCi } from "@/lib/telemetry/dimensions/ci-provider";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { parseTtl, type Ttl } from "@/lib/ttl";
import { reportWarning } from "@/lib/warnings";

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
 * How long a preview stays live, as `7d`, `12h` or `90m`. `parseTtl` refuses a
 * value that is not a duration, in its own words; the schema refuses one
 * outside the server's fixed limits of a minute and 365 days.
 */
const TTL = {
  schema: z
    .string()
    .transform(parseTtl)
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
  const found = detectPreviewUrls(env);
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
 * is built, whenever the token can read the project's origins.
 */
export async function refusePrimaryOrigins(
  urls: readonly string[],
  client: ZitadelClient,
  projectId: string,
): Promise<void> {
  const originService = new OriginService(client, projectId);
  // A token that may not read the project (403) leaves the server to decide
  // what it can deploy to. A 401 is a token the server does not accept at all,
  // which fails here rather than after the whole bundle is built.
  const production = await originService
    .primaryAmong(urls)
    .catch((error: unknown): readonly string[] => {
      if (error instanceof ForbiddenError) {
        return [];
      }
      throw error;
    });
  if (production.length > 0) {
    throw refusalError(PRIMARY_ORIGIN_REFUSAL, {
      origins: production.join(", "),
    });
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
export default class Preview extends PreviewCommand {
  static override description =
    "Deploy a release from .zitadel/ to a pull-request build's preview URLs.";
  static override group = CommandGroups.configuration;
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

  protected async execute({ flags }: Admitted<typeof Preview>): Promise<JsonEnvelope> {
    const skipped = this.skippedUnlessPreviewable(flags.strict);
    if (skipped !== undefined) {
      return this.emit(skipped);
    }
    const urls = readPreviewUrls(flags.origin ?? [], this.env);
    const { client, projectId } = await this.connect();
    await refusePrimaryOrigins(urls, client, projectId);

    const publisher = new Publisher(client, projectId);
    // The IdP step validates the connection files and stops short of syncing
    // them in a preview, so a pull-request build never reconfigures the
    // connections a merged deploy owns.
    const prepared = await publisher.prepare({
      cwd: this.cwd,
      env: this.env,
      mode: "preview",
      dryRun: this.dryRun,
      compare: false,
      json: this.isJson,
      color: this.isColored,
      suggest: this.suggest,
    });
    for (const warning of prepared.warnings) {
      reportWarning(warning);
    }
    this.narrate(prepared.notices);

    // A dry run validates and resolves the targets but writes nothing — no
    // release, no deployment, no preview registration — so a pull-request build
    // can check its `.zitadel/` without publishing, as `deploy --dry-run` does.
    if (this.dryRun) {
      const title = `Validated the preview for ${urls.length} ${new Intl.PluralRules("en").select(urls.length) === "one" ? "URL" : "URLs"} and deployed nothing (dry run)`;

      return this.emit({
        status: "ok",
        data: {
          title,
          dry_run: true,
          targets: urls,
        },
        pretty: prose(
          [
            title,
            ...urls.map((url) => {
              return `  - ${url}`;
            }),
          ].join("\n"),
        ),
        summary: {
          title,
          sections: [],
          lines: urls.map((url) => {
            return `  - ${escapeControlCharacters(url)}`;
          }),
        },
        next: {
          commands: [
            this.suggest({
              id: "preview",
              flags: {
                origin: [...urls],
                ttl: flags.ttl?.canonical,
                message: flags.message,
                strict: flags.strict,
              },
            }),
          ],
        },
      });
    }

    // The release keeps the message of whichever run built it first, usually
    // this one, so the deploy after merge reuses it rather than adding its own.
    const message = await deployMessage(flags.message, this.cwd, this.env);
    const { release, deployment } = await publisher.preview({
      prepared,
      message,
      urls,
      // The wire takes an ISO-8601 duration; `--ttl` keeps the `7d`/`12h`
      // spelling a person writes (create-deployment-request.yaml).
      ...(flags.ttl === undefined
        ? {}
        : {
            ttl: flags.ttl.iso,
          }),
    });

    // The deployment records no expiry; the live preview carries the one it set.
    const live = await new PreviewService(client, projectId).list();
    const expiries = new Map(
      live.map((preview) => {
        return [preview.origin, preview.expires_at] as const;
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

    return this.emit({
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
    });
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
            title: "nothing to preview — production is deployed after merge",
            sections: [],
          },
        };
      }
      case "unnamed-ci-build": {
        reportWarning(
          "This CI build names no environment, so the preview is skipped. Set ZITADEL_ENV=preview in the pull-request build that should deploy one.",
        );
        return {
          status: "skipped",
          reason: "nothing-to-preview",
          summary: {
            title: "nothing to preview — set ZITADEL_ENV=preview in the pull-request build",
            sections: [],
          },
        };
      }
      case "no-credential": {
        reportWarning(
          `No preview credential (${credential}) is set, so the preview is skipped; a fork pull-request build cannot read it. Pass --strict to fail instead.`,
        );
        return {
          status: "skipped",
          reason: "no-preview-credential",
          summary: {
            title: `no preview credential (${escapeControlCharacters(credential)}) — preview skipped`,
            sections: [],
          },
        };
      }
    }
  }
}
