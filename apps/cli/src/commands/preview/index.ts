import { Flags } from "@oclif/core";
import { z } from "zod";

import {
  type Admitted,
  CommandGroups,
  CREDENTIALS,
  type CommandResult,
  type JsonEnvelope,
  PREVIEW_CREDENTIAL,
  PreviewCommand,
} from "../../lib/oclif";
import {
  buildBundle,
  DeploymentService,
  ReleaseService,
  deployMessage,
  headSha,
  runSteps,
  MESSAGE_MAX_LENGTH,
  messageTooLong,
  type StepContext,
  validateStep,
  worktreeIsDirty,
} from "../../lib/backend";
import { ApiError } from "@zitadel/api/runtime/fetch";

import type { ZitadelClient } from "../../lib/api-client";
import { filled, reads, type Refused } from "../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../lib/oclif/refusal";
import { detectPreviewUrls } from "../../lib/preview";
import { runsInCi } from "../../lib/telemetry/dimensions/ci-provider";
import { parseTtl, type Ttl } from "../../lib/ttl";
import { reportWarning } from "../../lib/warnings";

const CREDENTIAL_REQUIRED_REFUSAL: Refusal = {
  message: "{credential} is not set",
  hint: "Set {credential} for this build, or drop --strict to skip the preview when it is absent.",
};

const NO_URLS_REFUSAL: Refusal = {
  message: "No preview URLs to deploy to",
  hint: "Pass --origin, or run inside a pull-request build that sets one of: {variables}.",
};

const PRIMARY_ORIGIN_REFUSAL: Refusal = {
  message: "{origins} is a primary origin",
  hint: "Pass the preview URLs with --origin; production is deployed by `zitadel deploy`, after merge.",
};

/** The shortest and longest a preview may live, as the server fixes them. */
const TTL_MINIMUM_MS = 60 * 1000;
const TTL_MAXIMUM_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * A preview URL as `--origin` names it. An origin has no path, so a trailing
 * slash is dropped and one preview is one spelling. It refuses a blank value
 * and `primary`, the deployment keyword for every primary origin, which a
 * preview build must never reach with its narrower credential.
 */
const ORIGIN: Refused<string> = {
  schema: filled
    .transform((origin) => {
      return origin.replace(/\/+$/, "");
    })
    .refine((origin) => {
      return origin !== "primary";
    }, "A preview cannot target the primary origins"),
  refusal: {
    message: "{problem}",
    hint: "Pass the preview URLs with --origin; production is deployed by `zitadel deploy`, after merge.",
  },
};

/**
 * How long a preview stays live, as `7d`, `12h` or `90m`. `parseTtl` refuses a
 * value that is not a duration, in its own words; the schema refuses one
 * outside the server's fixed limits of a minute and 365 days.
 */
const TTL: Refused<Ttl> = {
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
};

/**
 * What `-m/--message` records on the release this publishes. It refuses a blank
 * message, which would record nothing, and one longer than the server records,
 * which the server would reject after the bundle was built. `messageTooLong`
 * counts code points, as the server does, so the length is its call and not the
 * schema's. The message is trimmed.
 */
const MESSAGE: Refused<string> = {
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
};

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
 * skips the preview and the build carries on (#1312); `--strict` refuses
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
 * The project's primary origins, or none when the preview token may not read
 * the project (403): the server then decides alone what the token can deploy
 * to. A 401 is a token the server does not accept at all, which fails here
 * rather than after the whole bundle is built.
 */
async function primaryOrigins(client: ZitadelClient, projectId: string): Promise<string[]> {
  try {
    const project = await client.getProject(projectId);
    return project.origins
      .filter((entry) => {
        return entry.kind === "primary";
      })
      .map((entry) => {
        return entry.pattern;
      });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return [];
    }
    throw error;
  }
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
  const primaries = await primaryOrigins(client, projectId);
  const production = urls.filter((url) => {
    return primaries.includes(url);
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
 * cleanly rather than failing the build (#1312); `--strict` turns that warning
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

    const { bundle, brandingSources, idpFiles, policyFiles } = await buildBundle(this.cwd);
    const ctx: StepContext = {
      cwd: this.cwd,
      client,
      projectId,
      env: this.env,
      mode: "preview",
      dryRun: this.dryRun,
      json: this.isJson,
      color: this.isColored,
      bundle,
      brandingSources,
      idpFiles,
      policyFiles,
      suggest: (args) => this.suggest(args),
    };

    // The IdP step validates the connection files and stops short of syncing
    // them in a preview, so a pull-request build never reconfigures the
    // connections a merged deploy owns.
    await runSteps([validateStep], ctx);

    // A dry run validates and resolves the targets but writes nothing — no
    // release, no deployment, no preview registration — so a pull-request build
    // can check its `.zitadel/` without publishing, as `deploy --dry-run` does.
    if (this.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          dry_run: true,
          targets: urls,
        },
        pretty: [
          `Validated the preview for ${urls.length} URL${urls.length === 1 ? "" : "s"}. Nothing was deployed (dry run).`,
          ...urls.map((url) => `  - ${url}`),
        ].join("\n"),
      });
    }

    // The release keeps the message of whichever run built it first, usually
    // this one, so the deploy after merge reuses it rather than adding its own.
    const message = await deployMessage(flags.message, this.cwd, this.env);
    const release = await new ReleaseService(client, projectId).create(bundle, {
      message,
      gitSha: await headSha(this.cwd),
      gitDirty: await worktreeIsDirty(this.cwd),
    });
    const deployment = await new DeploymentService(client, projectId).deploy({
      releaseId: release.id,
      targets: [...urls],
      message,
      // The wire takes an ISO-8601 duration; `--ttl` keeps the `7d`/`12h`
      // spelling a person writes (create-deployment-request.yaml).
      ...(flags.ttl === undefined ? {} : { ttl: flags.ttl.iso }),
    });

    const previews = deployment.targets.map((target) => ({
      url: target.origin,
      expires_at: target.expires_at ?? null,
    }));
    return this.emit({
      status: "ok",
      data: {
        release_id: release.id,
        content_hash: release.content_hash,
        deployment_id: deployment.id,
        previews,
        release_env: `NEXT_PUBLIC_ZITADEL_RELEASE=${release.content_hash}`,
      },
      pretty: [
        `Previewed ${release.content_hash} on ${previews.length} URL${previews.length === 1 ? "" : "s"}`,
        ...previews.map((preview) =>
          preview.expires_at === null
            ? `  - ${preview.url}`
            : `  - ${preview.url} (until ${preview.expires_at})`,
        ),
        `NEXT_PUBLIC_ZITADEL_RELEASE=${release.content_hash}`,
      ].join("\n"),
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
      case "preview":
        return undefined;
      case "credential-required":
        throw refusalError(CREDENTIAL_REQUIRED_REFUSAL, {
          credential,
        });
      case "production-build":
        return {
          status: "skipped",
          reason: "nothing-to-preview",
          pretty: "nothing to preview — production is deployed by `zitadel deploy`, after merge",
        };
      case "unnamed-ci-build":
        reportWarning(
          "This CI build names no environment, so the preview is skipped. Set ZITADEL_ENV=preview in the pull-request build that should deploy one.",
        );
        return {
          status: "skipped",
          reason: "nothing-to-preview",
          pretty: "nothing to preview — set ZITADEL_ENV=preview in the pull-request build",
        };
      case "no-credential":
        reportWarning(
          `No preview credential (${credential}) is set, so the preview is skipped; a fork pull-request build cannot read it. Pass --strict to fail instead.`,
        );
        return {
          status: "skipped",
          reason: "no-preview-credential",
          pretty: `no preview credential (${credential}) — preview skipped`,
        };
    }
  }
}
