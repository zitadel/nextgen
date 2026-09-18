import { Flags } from "@oclif/core";

import { gitBranch } from "../lib/bundle";
import {
  DEFAULT_ENVIRONMENT,
  originsForEntry,
  readEnvironmentEntries,
} from "../lib/environments";
import { ZitadelError } from "../lib/errors";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { resolveCwd } from "../lib/paths";
import { readZitadelConfig } from "../lib/project";
import { publicCliCommand } from "../lib/public-cli";
import {
  buildRelease,
  connectEnvironment,
  deployRelease,
  ensurePreviewEnvironment,
  previewEnvironmentName,
  syncProjectOrigins,
} from "../lib/ship";

/**
 * `zitadel preview` — build a release from `.zitadel/` and deploy it to a
 * preview environment instead of `live`.
 *
 * A preview shares every user, session and credential with the project; it
 * only differs in which release it serves. Requests reach it by origin: the
 * frontend preview deployment's origin (`--origin`) is registered on the
 * preview, and the server routes any request arriving from that origin to
 * it. Everything else keeps being served by `live`.
 *
 * The preview is upserted, so re-running on the same name renews its expiry
 * and replaces its origins — CI can run it on every push of a branch.
 */
export default class Preview extends BaseCommand {
  static override description =
    "Build a release from .zitadel/ and deploy it to a preview environment.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 4;
  static override examples = [
    "<%= config.bin %> preview",
    "<%= config.bin %> preview --name pr-42 --origin https://my-app-git-feat-sso-acme.vercel.app",
    "<%= config.bin %> preview --name pr-42 --ttl 3d --release rel_01KX3RG8A7F0N9WD3P2E4YM5C1",
  ];
  static override flags = {
    env: Flags.string({
      char: "e",
      description:
        "Environment from zitadel.json whose project hosts the preview (default: preview, falling back to development).",
    }),
    name: Flags.string({
      char: "n",
      description:
        "Preview name; prefixed with preview- on the server. Defaults to the current git branch.",
    }),
    origin: Flags.string({
      char: "o",
      multiple: true,
      description:
        "Frontend origin or wildcard pattern (https://*.vercel.app) whose requests resolve to this preview. Repeatable. Defaults to the environment's issuer / issuer_pattern in zitadel.json.",
    }),
    ttl: Flags.string({
      description: "How long the preview lives from now, as 7d or 168h (default: 7d, max 30d).",
    }),
    message: Flags.string({
      char: "m",
      description: "Summary recorded on the release and the deployment.",
    }),
    release: Flags.string({
      description: "Deploy an existing release id instead of packaging .zitadel/.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Preview);
    const envName =
      flags.env ??
      (await defaultPreviewEnvironment(
        resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined),
      ));
    await this.toMeta({ ...flags, environment: envName });
    const { cwd, dryRun } = this.meta;

    const rawName = flags.name ?? (await gitBranch(cwd));
    if (!rawName) {
      throw new ZitadelError("E_VALIDATION", "A preview name is required", {
        hint: "Pass --name <slug> (for example the branch or pull request), or run inside a git checkout with a branch checked out.",
        nextCommands: [publicCliCommand("preview --name <slug>", this.meta.cliVersion)],
      });
    }
    const previewName = previewEnvironmentName(rawName);
    if (previewName === "preview-") {
      throw new ZitadelError("E_VALIDATION", `"${rawName}" leaves no characters for a preview name`);
    }
    const { target, client } = await connectEnvironment({
      cwd,
      name: envName,
      env: this.meta.env,
      serverFlag: this.meta.serverFlag,
    });
    // Explicit --origin wins; otherwise the preview serves whatever origins
    // the zitadel.json entry declares (the `https://*.vercel.app` pattern
    // setup wrote, typically).
    const explicit = (flags.origin ?? []).map((origin) => origin.trim()).filter(Boolean);
    const origins = explicit.length > 0 ? explicit : originsForEntry(target.entry);
    if (dryRun) {
      return this.emit({
        status: "skipped",
        reason: "dry-run",
        data: {
          environment: envName,
          server: target.server,
          project_id: target.projectId,
          target: previewName,
          origins,
        },
      });
    }

    const allowed = await syncProjectOrigins({ cwd, client, target });
    const release = await buildRelease({
      cwd,
      client,
      target,
      message: flags.message,
      releaseID: flags.release,
    });
    const preview = await ensurePreviewEnvironment({
      client,
      target,
      name: previewName,
      ttl: flags.ttl,
      origins,
    });
    const deployment = await deployRelease({
      client,
      target,
      environment: preview.name,
      releaseID: release.id,
      message: flags.message,
    });

    const nextActions = [
      `Preview ${preview.name} on ${target.projectId} serves release ${release.id}` +
        (preview.expires_at ? ` until ${preview.expires_at}.` : "."),
      origins.length > 0
        ? `Requests from ${origins.join(", ")} are served by this preview; everything else stays on live.`
        : "No origin registered yet: add an issuer_pattern to the environment in zitadel.json (for example https://*.vercel.app) or re-run with --origin <frontend origin>.",
      `To pin a specific release from the frontend regardless of origin, send the X-Zitadel-Release: ${release.id} header (configureZitadel({ release })).`,
      `When it looks right, ship the same release: zitadel deploy --release ${release.id}.`,
    ];
    return this.emit({
      status: "ok",
      data: {
        environment: envName,
        server: target.server,
        project_id: target.projectId,
        target: preview.name,
        allowed_origins: allowed.origins,
        preview,
        release,
        deployment,
        release_header: { "X-Zitadel-Release": release.id },
        next_actions: nextActions,
        next_commands: [
          publicCliCommand(`deploy --env production --release ${release.id}`, this.meta.cliVersion),
        ],
      },
    });
  }
}

/**
 * The preview command targets the `preview` entry of `zitadel.json` when the
 * app declares one (its project is where preview frontends point), else
 * `development`.
 */
async function defaultPreviewEnvironment(cwd: string): Promise<string> {
  try {
    const entries = readEnvironmentEntries(await readZitadelConfig(cwd));
    return "preview" in entries ? "preview" : DEFAULT_ENVIRONMENT;
  } catch {
    return DEFAULT_ENVIRONMENT;
  }
}
