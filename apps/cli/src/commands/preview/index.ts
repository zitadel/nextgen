import { Flags } from "@oclif/core";

import { CommandGroups, type JsonEnvelope, PreviewCommand, previewFlags } from "../../lib/oclif";
import {
  buildBundle,
  createDeployment,
  createReleaseFromBundle,
  headSha,
  runSteps,
  type StepContext,
  validateStep,
  worktreeIsDirty,
} from "../../lib/release";
import { detectPreviewUrls } from "../../lib/preview";
import { parseTtl } from "../../lib/ttl";
import { ZitadelError } from "../../lib/errors";
import { reportWarning } from "../../lib/warnings";

/**
 * `zitadel preview` — publish `.zitadel/` to a pull-request build's preview URLs.
 *
 * It is `deploy`'s counterpart for a preview environment: it assembles the same
 * release bundle, but runs only the validation step — a pull-request build must
 * never touch the live identity-provider connections the deploy step syncs —
 * and deploys to the preview URLs with a time-to-live rather than to the
 * primary origins. The URLs come from `--origin` or, failing that, from the
 * hosting platform's own build variables (Vercel, Netlify, Cloudflare Pages).
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
    const requested = flags.origin ?? [];
    const envName = this.environment.name.value;
    if (envName !== "preview" && envName !== "development") {
      return this.emit({
        status: "skipped",
        reason: "nothing-to-preview",
        pretty: "nothing to preview — production is deployed by `zitadel deploy`, after merge",
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

    // `--ttl` is optional: omitted, nothing is sent and the server applies the
    // project's default, rather than the CLI pinning a lifetime of its own.
    const ttl = flags.ttl === undefined ? undefined : parseTtl(flags.ttl);
    // A preview lives a minute at least and thirty days at most — the product
    // rule, applied here rather than in the generic TTL parser.
    if (ttl !== undefined && (ttl.ms < 60 * 1000 || ttl.ms > 30 * 24 * 60 * 60 * 1000)) {
      throw new ZitadelError("E_VALIDATION", `${flags.ttl} is outside the allowed range`, {
        hint: "A preview lives between 60s and 30d.",
      });
    }
    const { client, projectId } = await this.connect();

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
    };

    // Validation only: the IdP sync step is deploy-only, so a pull-request build
    // never reconfigures the connections a merged deploy owns.
    await runSteps([validateStep], ctx);

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

    // The create response carries non-fatal warnings — a preview deploy that
    // fell back to an `all` secret because a variable has no preview override,
    // so the preview URL serves the production credential (ADR 062 §7, #1617).
    // Surface each through the warnings channel so the operator sees it on the
    // terminal and in the `--json` envelope.
    for (const warning of deployment.warnings ?? []) {
      reportWarning(warning.message);
    }

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
