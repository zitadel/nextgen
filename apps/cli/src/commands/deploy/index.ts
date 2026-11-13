import { resolve } from "node:path";
import { Flags } from "@oclif/core";
import { z } from "zod";

import { Origins } from "@/lib/backend";
import { CANCELLED, confirmationHint, ZitadelError } from "@/lib/errors";
import {
  type Admitted,
  CommandGroups,
  type Connection,
  EnvironmentCommand,
  type JsonEnvelope,
} from "@/lib/oclif";
import { Destructive } from "@/lib/oclif/destructive";
import { reads, type Refused } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { readZitadelSecret } from "@/lib/project";
import {
  abbreviate,
  deployMessage,
  MESSAGE_MAX_LENGTH,
  messageTooLong,
  Publisher,
} from "@/lib/publish";
import { configIsDirty } from "@/lib/publish/git";
import {
  type NextOf,
  type Suggested,
  type SuggestedCommand,
  shellCommand,
  shellSteps,
  WHAT_CHANGED,
} from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";

/**
 * What `-m/--message` records. It refuses a blank message, which would record
 * nothing, and one longer than the server records, which the server would
 * reject later. `messageTooLong` counts code points, as the server does, so
 * the length is its call and not the schema's. The message is trimmed.
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
}): { hint: string; next: readonly Suggested[] } {
  const preview =
    input.issuer === undefined ? undefined : input.origins.heldAsPreview(input.issuer);
  if (preview !== undefined) {
    const held = `It holds its issuer ${preview} as a preview origin, as setup 0.1.0 registered it, so adding it as primary conflicts.`;
    if (input.setupProject) {
      return {
        hint: `${held} Make it primary, then deploy.`,
        next: [{ id: "doctor", flags: { fix: true } }],
      };
    }
    const remove: NextOf<"origin:rm"> = {
      id: "origin:rm",
      args: { pattern: preview },
      flags: { force: true },
    };
    const add: NextOf<"origin:add"> = {
      id: "origin:add",
      args: { pattern: preview },
      flags: { kind: "primary" },
    };
    return {
      hint: `${held} Remove it and add it back as primary, then deploy.`,
      // Both steps, in the order they must run: removing the pattern leaves
      // the project admitting every origin until it is added back.
      next: [remove, add],
    };
  }
  if (input.issuer !== undefined) {
    const add: NextOf<"origin:add"> = {
      id: "origin:add",
      args: { pattern: Origins.originOf(input.issuer) },
      flags: { kind: "primary" },
    };
    return {
      hint: "Add the URL the app serves from as a primary origin, then deploy.",
      next: [add],
    };
  }
  return {
    hint: "Add a primary origin for the URL the app serves from, then deploy.",
    next: [{ id: "origin:list" }],
  };
}

/**
 * The action a lockout refusal names: "Cannot … without --force".
 */
const LOCKOUT_ACTION = "deploy a release that leaves existing users unable to sign in";

const NEEDS_MESSAGE_REFUSAL = {
  message: "A deploy needs a message in non-interactive mode",
  hint: "Pass -m/--message with a short summary of what this release changes, or deploy from a clean git commit.",
} as const satisfies Refusal;

/** How a project with nowhere to land a deploy is refused. */
const NO_PRIMARY_ORIGIN_REFUSAL = {
  message: "The project has no primary origin to deploy to",
  hint: "{hint}",
  next: ["{next}"],
} as const satisfies Refusal;

/**
 * The commit that keeps what was deployed in git, aimed at the directory that
 * was deployed: `git` runs where the caller is, which is not where a `--cwd`
 * deploy ran. It carries the message the deploy used, so it can be run as it is.
 *
 * @param deployed - The directory that was deployed.
 * @param message - The message the deploy was given, if any.
 * @returns `git add` then `git commit` of `.zitadel/`, one after the other.
 */
function commitConfig(deployed: string, message: string | undefined): SuggestedCommand {
  const quote = (text: string): string => {
    return `'${text.replaceAll("'", "'\\''")}'`;
  };
  const where = resolve(deployed) === process.cwd() ? [] : ["-C", quote(deployed)];
  return shellSteps(
    shellCommand("git", ...where, "add", ".zitadel"),
    shellCommand(
      "git",
      ...where,
      "commit",
      "-m",
      quote(message ?? "<what changed>"),
      "--",
      ".zitadel",
    ),
  );
}

/**
 * `zitadel deploy` — publish `.zitadel/` to the project's primary origins.
 *
 * It assembles a release bundle from the files on disk, validates it and syncs
 * identity-provider connections, shows what changed since the live release as a
 * git diff, then creates the release and deploys it to every primary origin
 * (primary origins are never named one by one). `--dry-run` stops after the
 * diff, writing nothing to the server.
 */
export default class Deploy extends Destructive(EnvironmentCommand) {
  static override description =
    "Apply your local configuration to Zitadel.\n\nBuilds a release from .zitadel/ and deploys it to the project. Use --dry-run to preview what would change.";
  static override group = CommandGroups.configuration;
  static override groupOrder = 1;

  static override examples = [
    "<%= config.bin %> deploy -m 'add phone_number to human-user'",
    "<%= config.bin %> deploy --dry-run",
    "<%= config.bin %> deploy -m 'move users to the new schema' --force",
  ];
  static override flags = {
    // `--force` is per command, not global (ADR 064 §10): here it permits a
    // release that leaves existing users unable to sign in.
    force: Flags.boolean({
      char: "f",
      description:
        "Deploy even when the release leaves existing users unable to sign in, without asking. Required for that when non-interactive.",
    }),
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
    if (!this.dryRun) {
      await this.requirePrimaryOrigin(publisher, projectId, environment);
    }
    const prepared = await publisher.prepare({
      cwd: this.cwd,
      env: this.env,
      mode: "deploy",
      dryRun: this.dryRun,
      compare: true,
      json: this.isJson,
      color: this.isColored,
      suggest: this.suggest,
    });
    for (const warning of prepared.warnings) {
      reportWarning(warning);
    }
    this.narrate(prepared.notices);
    if (!(await this.confirmLockouts(prepared.lockouts))) {
      return this.emit({
        status: "skipped",
        reason: "deploy-cancelled",
        summary: {
          title: CANCELLED,
          sections: [],
        },
      });
    }
    const { resourceCount } = prepared;
    this.recordTelemetry({ resources: resourceCount });
    // The deploy again as it was typed (message and `--force` included), so a retry
    // or the real run after a dry run asks for the same thing.
    const again = async (): Promise<SuggestedCommand> => {
      return this.again("deploy", {
        without: ["dryRun"],
        with: flags.message === undefined ? { message: WHAT_CHANGED } : {},
      });
    };
    const resources = `${resourceCount} ${new Intl.PluralRules("en").select(resourceCount) === "one" ? "resource" : "resources"}`;

    if (this.dryRun) {
      const title = `Validated ${resources} and deployed nothing (dry run)`;

      return this.emit({
        status: "ok",
        data: {
          dry_run: true,
          title,
          resources: resourceCount,
          targets: "primary",
          ...prepared.report,
        },
        summary: {
          title,
          sections: [],
        },
        next: {
          commands: [await again()],
        },
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
    });
    switch (publication.outcome) {
      case "revoked": {
        throw new ZitadelError(
          "E_CONFLICT",
          `This content was already released as ${release.id}, which is revoked`,
          {
            hint: "A revoked release can never be served again. Change the configuration so it builds a new release, then deploy.",
            details: {
              release_id: release.id,
              content_hash: release.content_hash,
            },
          },
        );
      }
      case "raced": {
        throw new ZitadelError(
          "E_CONFLICT",
          "Another deploy changed the targets since this one was prepared",
          {
            hint: `Rerun ${await again()}; it will build and deploy against the current state.`,
            details:
              publication.current === undefined
                ? undefined
                : { current_deployment: publication.current },
            nextCommands: [this.suggest({ id: "deployment:list", flags: { live: true } })],
          },
        );
      }
      case "deployed": {
        break;
      }
    }
    const { deployment } = publication;

    const servedOrigins = deployment.origins;
    this.recordTelemetry({ origin_count: servedOrigins.length });

    // The release is live; if the tree was dirty, committing now keeps what was
    // deployed in git (the warning above says to commit before the next deploy).
    const configUncommitted = prepared.gitDirty && (await configIsDirty(this.cwd));

    const title = `Deployed ${resources}`;
    let live = `Release ${escapeControlCharacters(abbreviate(release.content_hash))} is now live.`;
    if (servedOrigins.length > 0) {
      live = `Release ${escapeControlCharacters(abbreviate(release.content_hash))} is now live on ${new Intl.ListFormat(
        "en",
        { type: "conjunction" },
      ).format(
        servedOrigins.map((origin) => {
          return escapeControlCharacters(origin);
        }),
      )}.`;
    }

    return this.emit({
      status: "ok",
      data: {
        title,
        release_id: release.id,
        content_hash: release.content_hash,
        deployment_id: deployment.id,
        resources: resourceCount,
        origins: servedOrigins,
        ...prepared.report,
      },
      summary: {
        title,
        sections: [],
        lines: [live],
      },
      next: {
        commands: [
          this.suggest({ id: "deployment:list" }),
          ...(configUncommitted ? [commitConfig(this.cwd, message)] : []),
        ],
      },
    });
  }

  /**
   * Report the existing users the release leaves unable to sign in, and go
   * ahead only with consent.
   *
   * @remarks
   * A person is asked; `--force` answers for them, and with nobody to ask and
   * no `--force` the deploy is refused. A dry run asks nobody, as it writes
   * nothing, but it still refuses where the real run would refuse without
   * asking, so a preview never passes a deploy that then fails; its re-run
   * keeps `--dry-run`.
   *
   * @param lockouts - What the lockout check found.
   * @returns Whether the deploy goes ahead.
   * @throws {@link ZitadelError} With `E_CONFIRMATION_REQUIRED` when nobody can
   *   be asked and `--force` was not given.
   */
  private async confirmLockouts(lockouts: readonly string[]): Promise<boolean> {
    if (lockouts.length === 0) {
      return true;
    }
    for (const lockout of lockouts) {
      reportWarning(lockout);
    }
    const { projectId, server } = await this.connect();
    const question = `Deploy to project ${projectId} on ${server.replace(/^https?:\/\//, "")} even though the users above will not be able to sign in?`;
    if (!this.dryRun) {
      const consent = await this.consent({
        verb: "deploy",
        name: LOCKOUT_ACTION,
        message: question,
      });
      return consent !== undefined;
    }
    if (this.nonInteractive && !this.force) {
      throw new ZitadelError(
        "E_CONFIRMATION_REQUIRED",
        `Cannot ${LOCKOUT_ACTION} without --force in non-interactive mode`,
        {
          hint: confirmationHint(question),
          details: { question },
          nextCommands: [await this.again("deploy", { with: { dryRun: true, force: true } })],
        },
      );
    }
    return true;
  }

  /**
   * Refuses a project with no primary origin, naming the step that gives it
   * one.
   */
  private async requirePrimaryOrigin(
    publisher: Publisher,
    projectId: string,
    environment: Connection["environment"],
  ): Promise<void> {
    const origins = await publisher.fetchLanding();
    if (origins.primary.length > 0) {
      return;
    }
    const setupProject = await readZitadelSecret(this.cwd).then(
      (secret) => {
        return secret.project_id;
      },
      () => {
        return undefined;
      },
    );
    const missing = missingPrimaryOrigin({
      origins,
      issuer: environment.values.ZITADEL_ISSUER?.value,
      setupProject: setupProject === projectId,
    });
    throw refusalError(NO_PRIMARY_ORIGIN_REFUSAL, { hint: missing.hint }, { next: missing.next });
  }
}
