import { Flags } from "@oclif/core";

import {
  type Admitted,
  CommandGroups,
  CREDENTIALS,
  type JsonEnvelope,
  PREVIEW_CREDENTIAL,
  PreviewCommand,
} from "../../lib/oclif";
import {
  buildBundle,
  createDeployment,
  createReleaseFromBundle,
  deployMessage,
  headSha,
  runSteps,
  type StepContext,
  validateStep,
  worktreeIsDirty,
} from "../../lib/release";
import { originFlag } from "./flags/origin";
import { messageFlag } from "./flags/message";
import { ttlFlag } from "./flags/ttl";
import { previewable } from "./requirements/previewable";
import { previewTargets } from "./requirements/targets";
import { previewUrls } from "./requirements/urls";

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
    origin: originFlag({
      description:
        "A preview URL to deploy to, instead of detecting them from the platform build. Repeatable.",
      multiple: true,
    }),
    ttl: ttlFlag({
      description:
        "How long the preview stays live, such as 7d, 12h or 90m. Between 60s and 365d. Defaults to the project's own lifetime.",
    }),
    message: messageFlag(
      "A short summary of what this release changes. Defaults to the pull request's title or the current commit's subject.",
    ),
    strict: Flags.boolean({
      description: `Fail instead of warning when no preview credential (${CREDENTIALS[PREVIEW_CREDENTIAL]}) is set.`,
    }),
  };

  static override requires = {
    environment: previewable,
    urls: previewUrls,
    targets: previewTargets,
  };

  protected async execute({
    flags,
    targets: urls,
  }: Admitted<typeof Preview>): Promise<JsonEnvelope> {
    const { client, projectId } = await this.connect();

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
    const release = await createReleaseFromBundle(client, projectId, bundle, {
      message,
      gitSha: await headSha(this.cwd),
      gitDirty: await worktreeIsDirty(this.cwd),
    });
    const deployment = await createDeployment(client, projectId, {
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
}
