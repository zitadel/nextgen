import { Flags } from "@oclif/core";
import { consola } from "consola";

import {
  matchesPattern,
  normalizeOrigins,
  parseTtl,
  platformPreviewOrigins,
  PREVIEW_URL_VARIABLES,
} from "../../lib/deployments";
import { ZitadelError } from "../../lib/errors";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../../lib/oclif";
import { publicCliCommand } from "../../lib/public-cli";
import { buildRelease } from "../../lib/release";
import { connectTarget, resolveTarget } from "../../lib/target";

/** The environments a preview run does its work in; anything else is a no-op. */
const PREVIEW_ENVIRONMENTS = new Set(["preview", "development"]);

/**
 * `zitadel preview` — build a release and deploy it to the preview URLs the
 * platform reports for this build, each for a limited time. Runs in every
 * platform build (`zitadel preview && next build`); a production build does
 * nothing and says so, since production is `zitadel deploy` after merge.
 */
export default class Preview extends BaseCommand {
  static override description =
    "Build a release and deploy it to this build's preview URLs, for a limited time.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 5;
  static override examples = [
    "<%= config.bin %> preview",
    "<%= config.bin %> preview --ttl 7d --origin https://acme-git-sso-acmeinc.vercel.app",
    "<%= config.bin %> preview --strict",
  ];
  static override flags = {
    origin: Flags.string({ multiple: true, description: "A preview URL to deploy to. Repeatable." }),
    ttl: Flags.string({ default: "7d", description: "How long the preview stays live, renewed on each run." }),
    message: Flags.string({ char: "m", description: "Summary recorded on the release and the deploy." }),
    strict: Flags.boolean({ description: "Fail instead of warning when no preview credential is present." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Preview);
    await this.toMeta(flags);
    const { cwd, env, dryRun, cliVersion, serverFlag, envName, envFile } = this.meta;

    const target = await resolveTarget({ cwd, env, serverFlag, envName, envFile });
    const environment = target.environment.value;
    if (!PREVIEW_ENVIRONMENTS.has(environment)) {
      return this.emit({
        status: "skipped",
        reason: "not-a-preview",
        data: { environment, source: target.environment.source },
        pretty: `environment  ${environment}   ${target.environment.source}\nnothing to preview — production is deployed by \`zitadel deploy\`, after merge`,
      });
    }

    const explicit = normalizeOrigins(flags.origin ?? []);
    const platform = explicit.length > 0 ? undefined : platformPreviewOrigins(env);
    const origins = explicit.length > 0 ? explicit : normalizeOrigins((platform?.origins ?? []).map((o) => o.url));
    if (origins.length === 0) {
      throw new ZitadelError("E_VALIDATION", "no preview URL found", {
        hint:
          `looked for: ${PREVIEW_URL_VARIABLES.join(", ")}\n` +
          "`zitadel preview` runs in a deploy pipeline, where the platform publishes the URL. " +
          "Local work needs no preview URL at all. To target a URL explicitly: zitadel preview --origin <url>",
        nextCommands: [publicCliCommand("preview --origin <url>", cliVersion)],
      });
    }

    const ttlSeconds = parseTtl(flags.ttl);
    if (!target.values.ZITADEL_PREVIEW_TOKEN && !target.values.ZITADEL_PROJECT_SECRET) {
      if (flags.strict) {
        throw new ZitadelError("E_VALIDATION", "no preview credential in the environment", {
          hint: "Set ZITADEL_PREVIEW_TOKEN in the platform's preview scope.",
        });
      }
      return this.emit({
        status: "skipped",
        reason: "no-credential",
        data: { environment, origins },
        pretty:
          "warning  no preview credential in the environment — skipping\n" +
          "         the app will build; sign-in on this preview will answer\n" +
          "         403 proj.preview_not_live until a credential is present",
      });
    }

    const { client, projectId, server, credentialSource } = await connectTarget(
      { cwd, env, serverFlag, envName, envFile },
      { credential: "preview" },
    );
    if (credentialSource === "ZITADEL_PROJECT_SECRET") {
      consola.warn("no ZITADEL_PREVIEW_TOKEN; deploying the preview with the project secret");
    }
    const project = await client.getProject(projectId);
    const checks = origins.map((origin) => ({
      origin,
      pattern: project.allowed_origins.find(
        (entry) => entry.kind === "preview" && matchesPattern(entry.pattern, origin),
      )?.pattern,
    }));
    const unmatched = checks.filter((check) => check.pattern === undefined);
    if (unmatched.length > 0) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${unmatched.map((check) => check.origin).join(", ")} matches no preview pattern of the project`,
        {
          hint: "Someone holding project.write adds a pattern once: zitadel allowlist add 'https://*-<team>.vercel.app' --kind preview",
          nextCommands: [publicCliCommand("allowlist", cliVersion)],
        },
      );
    }

    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: { environment, server, project_id: projectId, origins, ttl_seconds: ttlSeconds },
      });
    }

    consola.start("Building the release");
    const release = await buildRelease({ cwd, client, projectId, env, message: flags.message });
    const deploy = await client.createDeployment(
      {
        release: release.id,
        targets: origins,
        ttl_seconds: ttlSeconds,
        ...(flags.message ? { message: flags.message } : {}),
      },
      { project_id: projectId },
    );

    const expires = deploy.deployments[0]?.expires_at;
    const pretty = [
      ...(platform ? [`platform    ${platform.platform}`] : []),
      ...checks.map(
        (check, i) => `${i === 0 ? "origins    " : "           "} ${check.origin}   matches ${check.pattern} (preview)  ✓`,
      ),
      "",
      `release     ${release.id}  sha256:${release.content_hash.slice(0, 12)}  ${release.created ? "(new)" : "(exists, reusing)"}`,
      `origins     ${origins.length} row${origins.length === 1 ? "" : "s"} written${expires ? `, expire ${expires}` : ""}`,
      ...(deploy.warnings ?? []).map((warning) => `warning  ${warning}`),
      `deployed    ${deploy.deploy_id}   ${deploy.deployments.length} deployment records written`,
      "",
      `NEXT_PUBLIC_ZITADEL_RELEASE=sha256:${release.content_hash}`,
    ].join("\n");

    return this.emit({
      status: "ok",
      data: {
        environment,
        server,
        project_id: projectId,
        platform: platform?.platform,
        origins,
        ttl_seconds: ttlSeconds,
        release,
        deploy_id: deploy.deploy_id,
        deployments: deploy.deployments,
        warnings: deploy.warnings ?? [],
      },
      warnings: deploy.warnings ?? [],
      pretty,
    });
  }
}
