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
import { detectPreviewUrls, parseTtl } from "../../lib/preview";
import { ZitadelError } from "../../lib/errors";

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
 * It authenticates with the narrower preview credential, so it fails naming
 * `ZITADEL_PREVIEW_TOKEN` when that is not set and never falls back to the
 * project secret. Outside a preview or development environment there is nothing
 * to preview — even with an explicit `--origin` — so it says so and exits
 * cleanly without writing. The last line it prints is the release digest as
 * `NEXT_PUBLIC_ZITADEL_RELEASE`, for the build to pin.
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
  static override flags = { ...previewFlags };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Preview);
    await this.toMeta(flags);
    const { cwd, env, isTTY } = this.meta;
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

    const ttl = parseTtl(flags.ttl);
    const { client, projectId } = await this.connect();

    const { bundle, brandingSources } = await buildBundle(cwd);
    const ctx: StepContext = {
      cwd,
      client,
      projectId,
      env,
      mode: "preview",
      dryRun: false,
      json,
      color,
      bundle,
      brandingSources,
    };

    // Validation only: the IdP sync step is deploy-only, so a pull-request build
    // never reconfigures the connections a merged deploy owns.
    await runSteps([validateStep], ctx);

    const release = await createReleaseFromBundle(client, projectId, bundle, {
      gitSha: await headSha(cwd),
      gitDirty: await worktreeIsDirty(cwd),
    });
    const deployment = await createDeployment(client, projectId, {
      releaseId: release.id,
      targets: urls,
      ttl: ttl.wire,
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
