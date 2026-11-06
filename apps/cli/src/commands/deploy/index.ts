import { resolve } from "node:path";
import {
  type Admitted,
  CommandGroups,
  type Connection,
  EnvironmentCommand,
  type JsonEnvelope,
} from "@/lib/oclif";
import { Origins } from "@/lib/backend";
import { Publisher } from "@/lib/publish";
import { Flags } from "@oclif/core";
import { z } from "zod";

import { Cmd } from "@/lib/cmd";
import { ZitadelError } from "@/lib/errors";
import { reads, type Refused } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { readZitadelSecret } from "@/lib/project";
import { deployMessage, MESSAGE_MAX_LENGTH, messageTooLong } from "@/lib/publish";
import { configIsDirty } from "@/lib/publish/git";
import { DEPLOY_ARGS, shellCommand, type SuggestedCommand } from "@/lib/suggestion";
import { reportWarning } from "@/lib/warnings";
import { prose } from "@/lib/oclif/rendering";

/** How a non-interactive deploy with no message to fall back on is refused. */

/**
 * What `-m/--message` records. It refuses a blank message, which would record
 * nothing, and one longer than the server records, which the server would
 * reject later. `messageTooLong` counts code points, as the server does, so
 * the length is its call and not the schema's. The message is trimmed.
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

/**
 * What a deploy with no primary origin to land on tells the developer, naming
 * the step that gives the project one. A project `zitadel setup` 0.1.0 created
 * holds its issuer as a preview origin, which `origin add --kind primary`
 * refuses as a conflict: `doctor --fix` makes it primary for the project
 * `.zitadel/secret` records, the one doctor repairs, and any other project
 * removes the pattern and adds it back. Otherwise the issuer is added as
 * primary, or the URL the developer fills in when no issuer resolves.
 */
export function missingPrimaryOrigin(input: {
  origins: Origins;
  issuer: string | undefined;
  setupProject: boolean;
  suggest: (command: string) => SuggestedCommand;
}): { hint: string; next: readonly string[] } {
  const preview =
    input.issuer === undefined ? undefined : input.origins.heldAsPreview(input.issuer);
  if (preview !== undefined) {
    const held = `It holds its issuer ${preview} as a preview origin, as \`zitadel setup\` 0.1.0 registered it, so adding it as primary conflicts.`;
    if (input.setupProject) {
      return {
        hint: `${held} Run \`${input.suggest("doctor --fix")}\` to make it primary, then deploy.`,
        next: ["doctor --fix"],
      };
    }
    const remove = `origin rm ${Cmd.quote(preview)} --force`;
    const add = `origin add ${Cmd.quote(preview)} --kind primary`;
    return {
      hint: `${held} Remove it with \`${input.suggest(remove)}\`, add it back with \`${input.suggest(add)}\`, then deploy.`,
      // Both steps, in the order they must run: removing the pattern leaves
      // the project admitting every origin until it is added back.
      next: [remove, add],
    };
  }
  if (input.issuer !== undefined) {
    const add = `origin add ${Cmd.quote(Origins.originOf(input.issuer))} --kind primary`;
    return {
      hint: `Add the URL the app serves from with \`${input.suggest(add)}\`, then deploy.`,
      next: [add],
    };
  }
  return {
    hint: `Add one with \`${input.suggest("origin add <url> --kind primary")}\`, then deploy.`,
    next: ["origin list"],
  };
}

const NEEDS_MESSAGE_REFUSAL: Refusal = {
  message: "A deploy needs a message in non-interactive mode",
  hint: "Pass -m/--message with a short summary of what this release changes, or deploy from a clean git commit.",
};

/** How a project with nowhere to land a deploy is refused. */
const NO_PRIMARY_ORIGIN_REFUSAL: Refusal = {
  message: "The project has no primary origin to deploy to",
  hint: "{hint}",
  next: ["{next}"],
};

/**
 * The commit that keeps what was deployed in git, aimed at the directory that
 * was deployed: `git` runs where the caller is, which is not where a `--cwd`
 * deploy ran. It carries the message the deploy used, so it can be run as it is.
 */
function commitConfig(deployed: string, message: string | undefined): string {
  const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;
  const git = resolve(deployed) === process.cwd() ? "git" : `git -C ${quote(deployed)}`;
  return `${git} add .zitadel && ${git} commit -m ${quote(message ?? "<what changed>")} -- .zitadel`;
}

/**
 * `zitadel deploy` — publish `.zitadel/` to the project's primary origins.
 *
 * It assembles a release bundle from the files on disk, validates it and syncs
 * identity-provider connections, shows what changed since the live release as a
 * git diff, then creates the release and deploys it to every primary origin
 * (primary origins are never named one by one). `--dry-run` stops after the
 * diff, writing nothing to the server.
 *
 * It replaces `plan` and `apply`: a release is published as one immutable unit
 * and deployed, rather than each resource being synced in place.
 */
export default class Deploy extends EnvironmentCommand {
  static override description =
    "Apply your local configuration to Zitadel.\n\nBuilds a release from .zitadel/ and deploys it to the project. Use --dry-run to preview what would change.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 1;
  static override examples = [
    "<%= config.bin %> deploy -m 'add phone_number to human-user'",
    "<%= config.bin %> deploy --dry-run",
  ];
  static override flags = {
    message: Flags.custom<string>({
      parse: reads(MESSAGE),
    })({
      char: "m",
      description:
        "A short summary of what this release changes. Defaults to the pull request's title or the current commit's subject.",
    }),
  };

  protected async execute({ flags }: Admitted<typeof Deploy>): Promise<JsonEnvelope> {
    // Why the deploy happened: the message it was given, or the one its
    // environment implies. Interactively it can be left off; a scripted run
    // with nothing to fall back on must name one, and is refused before
    // anything is built or asked for — the message is the directory's and the
    // environment's to answer, so nothing is connected to find it out. A dry
    // run records nothing, so it needs none.
    const message = this.dryRun
      ? undefined
      : await deployMessage(flags.message, this.cwd, this.env);
    if (!this.dryRun && this.nonInteractive && message === undefined) {
      throw refusalError(NEEDS_MESSAGE_REFUSAL, {});
    }
    const { client, projectId, environment } = await this.connect();
    // A deploy goes to every primary origin, so the project must have one.
    // Checked before the bundle is built and the IdP connections are synced,
    // so a project with none fails before the IdP step writes part of a
    // change. A dry run never reaches the deploy, so it is exempt.
    const publisher = new Publisher(client, projectId);
    const landing = this.dryRun ? [] : await this.primaryOrigins(publisher, projectId, environment);
    const prepared = await publisher.prepare({
      cwd: this.cwd,
      env: this.env,
      mode: "deploy",
      dryRun: this.dryRun,
      compare: true,
      json: this.isJson,
      color: this.isColored,
      suggest: (args) => {
        return this.suggest(args);
      },
    });
    for (const warning of prepared.warnings) {
      reportWarning(warning);
    }
    for (const notice of prepared.notices) {
      process.stdout.write(notice);
    }
    const { resourceCount } = prepared;
    this.recordTelemetry({ resources: resourceCount });

    if (this.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          dry_run: true,
          resources: resourceCount,
          targets: "primary",
          ...prepared.report,
        },
        pretty: prose(
          `Validated ${resourceCount} resource${resourceCount === 1 ? "" : "s"}. Nothing was deployed (dry run).`,
        ),
      });
    }

    // Record whether the whole worktree was dirty when this release was built,
    // and warn: a release pins content, but its git provenance is only exact
    // when the tree was clean, so the reader knows the commit is approximate.
    if (prepared.gitDirty) {
      reportWarning(
        "The git working tree has uncommitted changes, so this release records its commit as approximate and the next deploy cannot diff against it. Commit before you deploy to keep the diff exact.",
      );
    }

    const { release, publication } = await publisher.deploy({
      prepared,
      message,
      landing,
    });
    switch (publication.outcome) {
      case "revoked":
        throw new ZitadelError(
          "E_CONFLICT",
          `This content was already released as ${release.id}, which is revoked`,
          {
            hint: "A revoked release can never be served again. Change the configuration so it builds a new release, then deploy.",
            details: { release_id: release.id, content_hash: release.content_hash },
          },
        );
      case "raced":
        throw new ZitadelError(
          "E_CONFLICT",
          "Another deploy changed the targets since this one was prepared",
          {
            hint: `Re-run \`zitadel ${DEPLOY_ARGS}${this.environmentSelector()}\`; it will build and deploy against the current state.`,
            details:
              publication.current === undefined
                ? undefined
                : { current_deployment: publication.current },
            nextCommands: [this.suggest("deployment list --live")],
          },
        );
      case "deployed":
        break;
    }
    const { deployment } = publication;

    const servedOrigins = deployment.origins;
    this.recordTelemetry({ origin_count: servedOrigins.length });

    // The release is live; if the tree was dirty, committing now keeps what was
    // deployed in git (the warning above says to commit before the next deploy).
    const configUncommitted = prepared.gitDirty && (await configIsDirty(this.cwd));

    return this.emit({
      status: "ok",
      data: {
        release_id: release.id,
        content_hash: release.content_hash,
        deployment_id: deployment.id,
        resources: resourceCount,
        origins: servedOrigins,
        ...prepared.report,
      },
      next: {
        commands: [
          this.suggest("deployment list"),
          ...(configUncommitted ? [shellCommand(commitConfig(this.cwd, message))] : []),
        ],
      },
      pretty: prose(
        [
          `Deployed ${release.content_hash}`,
          `  ${resourceCount} resource${resourceCount === 1 ? "" : "s"} to ${servedOrigins.length} origin${servedOrigins.length === 1 ? "" : "s"}`,
          ...servedOrigins.map((served) => {
            return `  - ${served}`;
          }),
        ].join("\n"),
      ),
    });
  }

  /**
   * The primary origins this deploy lands on, refusing a project with none and
   * naming the step that gives it one.
   */
  private async primaryOrigins(
    publisher: Publisher,
    projectId: string,
    environment: Connection["environment"],
  ): Promise<readonly string[]> {
    const origins = await publisher.landing();
    const landing = origins.primary;
    if (landing.length > 0) {
      return landing;
    }
    const setupProject = await readZitadelSecret(this.cwd).then(
      (secret) => {
        return secret.project_id;
      },
      () => {
        return undefined;
      },
    );
    throw refusalError(
      NO_PRIMARY_ORIGIN_REFUSAL,
      missingPrimaryOrigin({
        origins,
        issuer: environment.values.ZITADEL_ISSUER?.value,
        setupProject: setupProject === projectId,
        suggest: (command) => {
          return this.suggest(command);
        },
      }),
      (next) => {
        return this.suggest(next);
      },
    );
  }
}
