import { Flags } from "@oclif/core";
import type { ZitadelClient } from "@zitadel/api/client";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { CommandGroups, type JsonEnvelope, PreviewCommand, previewFlags } from "../../lib/oclif";
import {
  buildBundle,
  createDeployment,
  createReleaseFromBundle,
  headSha,
  idpConnectionsStep,
  runSteps,
  type StepContext,
  validateStep,
  worktreeIsDirty,
} from "../../lib/release";
import { detectPreviewUrls } from "../../lib/preview";
import { parseTtl } from "../../lib/ttl";
import { ZitadelError } from "../../lib/errors";
import { reportWarning } from "../../lib/warnings";
import { ciProvider } from "../../lib/telemetry/dimensions/ci-provider";
import { envEnabled } from "../../lib/telemetry/dimensions/env-flag";

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
  ];
  static override flags = {
    ...previewFlags,
    // Preview-only: `preview list` and `preview rm` share the credential but
    // have no deploy to make strict, so this lives here, not in `previewFlags`.
    strict: Flags.boolean({
      description:
        "Fail instead of warning when no preview credential (ZITADEL_PREVIEW_TOKEN) is set.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Preview);
    await this.toMeta(flags);
    const { cwd, env, isTTY, dryRun } = this.meta;
    const json = this.jsonEnabled();
    const color = !json && isTTY && flags.color !== false && !process.env.NO_COLOR;

    // Only a preview or development build has anything to preview: a production
    // (or any other non-preview) build serves the deployed release, published by
    // `zitadel deploy` after merge. The environment gates this, not `--origin`:
    // an explicit origin only selects which targets to preview, it never
    // authorizes a preview deploy into an environment that must not take writes.
    // An origin has no path, so a trailing slash is the same URL: dropped
    // here as detection drops it, so one preview is one spelling — and a URL
    // given twice is sent once, as the request's unique targets require.
    const requested = [...new Set((flags.origin ?? []).map((url) => url.replace(/\/+$/, "")))];
    // `primary` is the deployment keyword for every primary origin. A preview
    // build carries the preview credential and must never be able to reach
    // production with it, so the keyword is refused outright.
    if (requested.includes("primary")) {
      throw new ZitadelError("E_VALIDATION", "A preview cannot target the primary origins", {
        hint: "Pass the preview URLs with --origin; production is deployed by `zitadel deploy`, after merge.",
      });
    }

    // `--ttl` is optional: omitted, nothing is sent and the server applies the
    // project's default, rather than the CLI pinning a lifetime of its own.
    // Checked before anything that can skip the run, so a bad value fails every
    // build rather than only the trusted ones that reach the deploy.
    const ttl = flags.ttl === undefined ? undefined : parseTtl(flags.ttl);
    // A preview lives a minute at least and thirty days at most — the product
    // rule, applied here rather than in the generic TTL parser.
    if (ttl !== undefined && (ttl.ms < 60 * 1000 || ttl.ms > 30 * 24 * 60 * 60 * 1000)) {
      throw new ZitadelError("E_VALIDATION", `${flags.ttl} is outside the allowed range`, {
        hint: "A preview lives between 60s and 30d.",
      });
    }

    const envName = this.environment.name.value;
    if (envName !== "preview" && envName !== "development") {
      return this.emit({
        status: "skipped",
        reason: "nothing-to-preview",
        pretty: "nothing to preview — production is deployed by `zitadel deploy`, after merge",
      });
    }
    // `development` by default is a developer's machine. In a CI build it is
    // only a platform the resolver cannot read (anything but Vercel and
    // Netlify), which may be a production build, so it must say it is a
    // preview build rather than be taken for one.
    if (this.environment.name.source === "default" && runsInCi(env)) {
      reportWarning(
        "This CI build names no environment, so the preview is skipped. Set ZITADEL_ENV=preview in the pull-request build that should deploy one.",
      );
      return this.emit({
        status: "skipped",
        reason: "nothing-to-preview",
        pretty: "nothing to preview — set ZITADEL_ENV=preview in the pull-request build",
      });
    }

    // A fork pull-request build cannot read the preview credential — a secret
    // is never exposed to a fork — so a missing `ZITADEL_PREVIEW_TOKEN` is not
    // a build failure: the preview is skipped and the build carries on (#1312).
    // `--strict` is for a trusted build that expects the token, where a missing
    // one is a misconfiguration worth failing on. The project secret is never a
    // stand-in, so its presence does not satisfy this.
    if (this.environment.values.ZITADEL_PREVIEW_TOKEN === undefined) {
      if (flags.strict) {
        throw new ZitadelError("E_VALIDATION", "ZITADEL_PREVIEW_TOKEN is not set", {
          hint: "Set ZITADEL_PREVIEW_TOKEN for this build, or drop --strict to skip the preview when it is absent.",
        });
      }
      reportWarning(
        "No preview credential (ZITADEL_PREVIEW_TOKEN) is set, so the preview is skipped; a fork pull-request build cannot read it. Pass --strict to fail instead.",
      );
      return this.emit({
        status: "skipped",
        reason: "no-preview-credential",
        pretty: "no preview credential (ZITADEL_PREVIEW_TOKEN) — preview skipped",
      });
    }

    // Preview URLs come from `--origin`, else from the platform build variables.
    let urls = requested;
    if (urls.length === 0) {
      const detected = detectPreviewUrls(env);
      if (detected.urls.length === 0) {
        throw new ZitadelError("E_VALIDATION", "No preview URLs to deploy to", {
          hint: `Pass --origin, or run inside a pull-request build that sets one of: ${detected.variablesLookedFor.join(", ")}.`,
        });
      }
      urls = [...detected.urls];
    }

    const { client, projectId } = await this.connect();

    // An exact primary origin is production as surely as the `primary`
    // keyword is, so it is refused too. The server is the authority on what
    // the preview token may reach; this catches the mistake before anything
    // is built, whenever the token can read the project's origins.
    const primaries = await primaryOrigins(client, projectId);
    const production = urls.filter((url) => primaries.includes(url));
    if (production.length > 0) {
      throw new ZitadelError("E_VALIDATION", `${production.join(", ")} is a primary origin`, {
        hint: "Pass the preview URLs with --origin; production is deployed by `zitadel deploy`, after merge.",
      });
    }

    const { bundle, brandingSources } = await buildBundle(cwd);
    const ctx: StepContext = {
      cwd,
      client,
      projectId,
      env,
      mode: "preview",
      dryRun,
      json,
      color,
      bundle,
      brandingSources,
      suggest: (args) => this.suggest(args),
    };

    // The IdP step validates the connection files and stops short of syncing
    // them in a preview, so a pull-request build never reconfigures the
    // connections a merged deploy owns.
    await runSteps([validateStep, idpConnectionsStep], ctx);

    // A dry run validates and resolves the targets but writes nothing — no
    // release, no deployment, no preview registration — so a pull-request build
    // can check its `.zitadel/` without publishing, as `deploy --dry-run` does.
    if (dryRun) {
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

    const release = await createReleaseFromBundle(client, projectId, bundle, {
      gitSha: await headSha(cwd),
      gitDirty: await worktreeIsDirty(cwd),
    });
    const deployment = await createDeployment(client, projectId, {
      releaseId: release.id,
      targets: urls,
      ...(ttl === undefined ? {} : { ttl: ttl.canonical }),
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
}

/**
 * The project's primary origins, or none when the preview token may not read
 * the project (403): the server then decides alone what the token can deploy
 * to. A 401 is a token the server does not accept at all, which fails here
 * rather than after the whole bundle is built.
 */
async function primaryOrigins(client: ZitadelClient, projectId: string): Promise<string[]> {
  try {
    const origins = (await client.getProject(projectId)).origins ?? [];
    return origins.filter((entry) => entry.kind === "primary").map((entry) => entry.pattern);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return [];
    }
    throw error;
  }
}

/**
 * Whether this runs in a CI build: the providers the CLI already recognises
 * (`CI`, or a provider's own marker such as Jenkins' `JENKINS_URL`), plus the
 * builds that set neither: Cloudflare Pages, Azure Pipelines and AWS CodeBuild.
 */
function runsInCi(env: NodeJS.ProcessEnv): boolean {
  return (
    ciProvider.value(env) !== undefined ||
    env.CF_PAGES === "1" ||
    envEnabled(env.TF_BUILD) ||
    envEnabled(env.CODEBUILD_BUILD_ID)
  );
}
