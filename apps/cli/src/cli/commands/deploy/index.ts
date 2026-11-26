import { dryRunResult } from "@/cli/core/crud/shared";
import { resolve } from "node:path";
import { Flags } from "@oclif/core";
import { z } from "zod";

import { Origins } from "@/lib/backend";
import { Cmd } from "@/lib/cmd";
import { confirmationHint, ZitadelError } from "@/lib/errors";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, Connection, CommandResult } from "@/cli/core";
import { reads, type Refused } from "@/cli/core/flags";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import {
  abbreviate,
  deployMessage,
  MESSAGE_MAX_LENGTH,
  type Lockout,
  messageTooLong,
  Publisher,
  PublishConfigInvalidError,
  PublishConnectionSecretLiteralError,
  PublishConnectionVariableKindError,
  PublishConnectionVariableMissingError,
  PublishConnectionVariableSharedError,
} from "@/lib/publish";
import {
  type NextOf,
  type Suggested,
  type SuggestedCommand,
  shellCommand,
  shellSteps,
  WHAT_CHANGED,
} from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { warnings } from "@/lib/ui";
import { Project } from "@/lib/project";
import { RemoveCommand } from "@/cli/commands/bases";
import { Telemetered } from "@/cli/telemetry/telemetered";

/** How a configuration with errors is refused. */
const CONFIG_INVALID_REFUSAL = {
  message: "{message}",
  hint: "Fix the files named above and rerun; no changes were made.",
} as const satisfies Refusal;

/** How a connection that holds its secret itself is refused. */
const SECRET_LITERAL_REFUSAL = {
  message: "{message}",
  hint: 'Publish a secret with the command below and reference it as "${{ NAME }}".',
  next: [
    {
      id: "variable:set",
      args: {
        name: "NAME",
      },
      flags: {
        secret: true,
      },
    },
  ],
} as const satisfies Refusal;

/** How a connection whose client id and secret name one variable is refused. */
const VARIABLE_SHARED_REFUSAL = {
  message: "{message}",
  hint: "Give each its own variable: a plain one for the client id, a secret one for the client secret.",
} as const satisfies Refusal;

/** How a connection that names a variable the project does not have is refused. */
const VARIABLE_MISSING_REFUSAL = {
  code: "E_CREDENTIAL_MISSING",
  message: "{message}",
  hint: "Publish it with the command below, then deploy again.",
  next: ["{set}"],
} as const satisfies Refusal;

/** How a connection that names a variable of the wrong kind is refused. */
const VARIABLE_KIND_REFUSAL = {
  message: "{message}",
  hint: "{hint}",
  next: ["{set}"],
} as const satisfies Refusal;

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
 * primary, or the URL the developer fills in when no issuer resolves. When both
 * steps are given they are listed in the order they must run: removing the
 * pattern leaves the project admitting every origin until it is added back.
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
        next: [
          {
            id: "doctor",
            flags: { fix: true },
          },
        ],
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
 * @param referenced - The files the release inlines from outside `.zitadel/`.
 * @returns `git add` then `git commit` of `.zitadel/` and those files, one after the other.
 */
function commitConfig(
  deployed: string,
  message: string | undefined,
  referenced: readonly string[],
): SuggestedCommand {
  const paths = [
    ".zitadel",
    ...referenced.map((path) => {
      return Cmd.quote(path);
    }),
  ];
  const where = resolve(deployed) === process.cwd() ? [] : ["-C", Cmd.quote(deployed)];
  return shellSteps(
    shellCommand("git", ...where, "add", ...paths),
    shellCommand(
      "git",
      ...where,
      "commit",
      "-m",
      Cmd.quote(message ?? "<what changed>"),
      "--",
      ...paths,
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
export default class Deploy extends Telemetered(
  RemoveCommand(
    "Deploy even when the release leaves existing users unable to sign in, without asking. Required for that when non-interactive.",
  ),
) {
  static override description =
    "Apply your local configuration to Zitadel.\n\nBuilds a release from .zitadel/ and deploys it to the project. Use --dry-run to preview what would change.";
  static override group = CommandGroups.releases;
  static override groupOrder = 1;

  static override examples = [
    "<%= config.bin %> deploy -m 'add phone_number to human-user'",
    "<%= config.bin %> deploy --dry-run",
    "<%= config.bin %> deploy -m 'move users to the new schema' --force",
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

  /**
   * Says what the command would do, without doing it.
   *
   * A dry run records nothing, so it needs no message. It asks nobody about the
   * users the release leaves unable to sign in, as it writes nothing, but it
   * still refuses where the real run would refuse without asking, so a preview
   * never passes a deploy that then fails; its re-run keeps `--dry-run`. It
   * never reaches the deploy, so it is exempt from the primary origin check.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The envelope of the dry run.
   */
  protected async preview({ flags }: Admitted<typeof Deploy>): Promise<CommandResult> {
    const publisher = await this.service(Publisher);
    this.annotate({ stage: "validation" });
    const prepared = await this.prepare(publisher, {
      cwd: this.cwd,
      env: this.env,
      mode: "deploy",
      dryRun: true,
      compare: true,
    });
    this.annotate({ stage: undefined });
    const diff = this.said(prepared);
    const question = await this.lockoutQuestion(prepared.lockouts);
    if (question !== undefined && this.nonInteractive && !this.force) {
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
    const { resourceCount } = prepared;
    this.annotate({ resources: resourceCount });
    const resources = `${resourceCount} ${new Intl.PluralRules("en").select(resourceCount) === "one" ? "resource" : "resources"}`;
    const result = dryRunResult({
      verb: "deploy",
      topic: "release",
      noun: resources,
      next: await this.again("deploy", {
        without: ["dryRun"],
        with: flags.message === undefined ? { message: WHAT_CHANGED } : {},
      }),
    });

    return {
      ...result,
      data: {
        ...(result.data as object),
        resources: resourceCount,
        targets: "primary",
        ...prepared.report,
      },
      summary: {
        ...result.summary,
        lines: diff,
      },
    };
  }

  /**
   * Publishes the release and deploys it.
   *
   * The message says why the deploy happened: the one it was given, or the one
   * its environment implies. Interactively it can be left off; a scripted run
   * with nothing to fall back on must name one, and is refused before anything
   * is built or asked for, since the message is the directory's and the
   * environment's to answer and nothing is connected to find it out.
   *
   * A deploy goes to every primary origin, so the project must have one. That
   * is checked before the bundle is built and the IdP connections are synced,
   * so a project with none fails before the IdP step writes part of a change.
   *
   * The preparation notices are said before the steps that can fail or be
   * declined, and kept for a result that a pipe reads. The deploy suggested
   * again is the one as it was typed (message and `--force` included), so a
   * retry asks for the same thing.
   *
   * A release pins content, but its git provenance is only exact when the files
   * it is built from were committed, so a build from a dirty file is recorded
   * as approximate and warned about, which lets the reader know the commit is
   * approximate. A change to any other file in the repository does not count.
   * Once the release is live, committing keeps what was deployed in git.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The envelope of the run.
   */
  protected async apply({ flags }: Admitted<typeof Deploy>): Promise<CommandResult> {
    const message = await deployMessage(flags.message, this.cwd, this.env);
    if (this.nonInteractive && message === undefined) {
      throw refusalError(NEEDS_MESSAGE_REFUSAL, {});
    }
    const { client, projectId, environment } = await this.connect();
    const publisher = new Publisher(client, projectId);
    await this.requirePrimaryOrigin(publisher, projectId, environment);
    this.annotate({ stage: "validation" });
    const prepared = await this.prepare(publisher, {
      cwd: this.cwd,
      env: this.env,
      mode: "deploy",
      dryRun: false,
      compare: true,
    });
    this.annotate({ stage: undefined });
    const diff = this.said(prepared);
    const question = await this.lockoutQuestion(prepared.lockouts);
    if (question !== undefined) {
      const consent = await this.consent({
        verb: "deploy",
        name: LOCKOUT_ACTION,
        message: question,
      });
      if (consent === undefined) {
        return this.cancelled("deploy");
      }
    }
    const { resourceCount } = prepared;
    this.annotate({ resources: resourceCount });
    const resources = `${resourceCount} ${new Intl.PluralRules("en").select(resourceCount) === "one" ? "resource" : "resources"}`;

    if (prepared.gitDirty) {
      warnings.report(
        "A file this release is built from has uncommitted changes, so this release records its commit as approximate and the next deploy cannot diff against it. Commit before you deploy to keep the diff exact.",
      );
    }

    const { release, publication } = await publisher.deploy(
      {
        prepared,
        message,
      },
      (stage) => {
        this.annotate({ stage });
      },
    );
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
        const again = await this.again("deploy", {
          without: ["dryRun"],
          with: flags.message === undefined ? { message: WHAT_CHANGED } : {},
        });

        throw new ZitadelError(
          "E_CONFLICT",
          "Another deploy changed the targets since this one was prepared",
          {
            hint: `Rerun ${again}; it will build and deploy against the current state.`,
            details:
              publication.current === undefined
                ? undefined
                : { current_deployment: publication.current },
            nextCommands: [
              this.suggest({
                id: "deployment:list",
                flags: { live: true },
              }),
            ],
          },
        );
      }
      case "deployed": {
        break;
      }
    }
    const { deployment } = publication;
    this.annotate({
      stage: undefined,
      changed_configuration_types: prepared.changedConfiguration,
    });

    const servedOrigins = deployment.origins;
    this.annotate({ origin_count: servedOrigins.length });

    const title = `Deployed ${resources}`;
    const released = `Release ${escapeControlCharacters(abbreviate(release.content_hash))} is now live`;
    const live =
      servedOrigins.length > 0
        ? `${released} on ${new Intl.ListFormat("en", { type: "conjunction" }).format(
            servedOrigins.map((origin) => {
              return escapeControlCharacters(origin);
            }),
          )}.`
        : `${released}.`;

    return {
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
        lines: [...diff, ...(diff.length === 0 ? [] : [""]), live],
      },
      next: {
        commands: [
          this.suggest({ id: "deployment:list" }),
          ...(prepared.gitDirty ? [commitConfig(this.cwd, message, prepared.referenced)] : []),
        ],
      },
    };
  }

  /**
   * Reports what preparing the release found and says the notices a person
   * reads before the steps that can fail or be declined.
   *
   * @param prepared - The prepared release.
   * @returns The notices as the lines a result carries.
   */
  private said(prepared: Awaited<ReturnType<Publisher["prepare"]>>): string[] {
    for (const warning of prepared.warnings) {
      warnings.report(warning);
    }
    this.narrate(prepared.notices);

    return prepared.notices.flatMap((notice, at) => {
      return [...(at === 0 ? [] : [""]), ...notice.replace(/\n+$/, "").split("\n")];
    });
  }

  /**
   * Prepares what is published, refusing a configuration that cannot be
   * published and saying how to fix it.
   *
   * @param publisher - The publisher.
   * @param input - What to prepare.
   * @returns What was prepared.
   * @throws {@link ZitadelError} The refusal for the condition publishing stopped on; an
   *   error nobody anticipated is thrown as it was.
   */
  private async prepare(publisher: Publisher, input: Parameters<Publisher["prepare"]>[0]) {
    try {
      return await publisher.prepare(input);
    } catch (error) {
      if (error instanceof PublishConnectionSecretLiteralError) {
        throw refusalError(SECRET_LITERAL_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof PublishConnectionVariableSharedError) {
        throw refusalError(VARIABLE_SHARED_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof PublishConnectionVariableMissingError) {
        throw refusalError(
          VARIABLE_MISSING_REFUSAL,
          {
            ...error,
            message: error.message,
          },
          {
            set: {
              id: "variable:set",
              args: {
                name: error.variable,
              },
              flags: {
                secret: error.secret,
                preview: input.mode === "preview",
              },
            },
          },
        );
      }
      if (error instanceof PublishConnectionVariableKindError) {
        throw refusalError(
          VARIABLE_KIND_REFUSAL,
          {
            ...error,
            message: error.message,
            hint: error.secret
              ? "The client secret must be a secret variable: publish it with the command below."
              : "The client id must be a plain variable the engine can read back: publish it with the command below, without --secret.",
          },
          {
            set: {
              id: "variable:set",
              args: {
                name: error.variable,
              },
              flags: {
                secret: error.secret,
                preview: input.mode === "preview",
              },
            },
          },
        );
      }
      if (error instanceof PublishConfigInvalidError) {
        throw refusalError(CONFIG_INVALID_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      throw error;
    }
  }

  /**
   * Reports the existing users the release leaves unable to sign in, and
   * words the question that asks whether to go ahead anyway.
   *
   * @param lockouts - What the lockout check found.
   * @returns The question, or `undefined` when nobody is locked out.
   */
  private async lockoutQuestion(lockouts: readonly Lockout[]): Promise<string | undefined> {
    if (lockouts.length === 0) {
      return undefined;
    }
    for (const lockout of lockouts) {
      warnings.report(
        lockout.fix === undefined
          ? lockout.message
          : `${lockout.message}: ${this.suggest(lockout.fix)}`,
      );
    }
    return `Deploy to ${await this.projectOnServer()} even though the users above will not be able to sign in?`;
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
    const setupProject = await Project.at(this.cwd)
      .secret()
      .then(
        (secret) => {
          return secret.data.project_id;
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
