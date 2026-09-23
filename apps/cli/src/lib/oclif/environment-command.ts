import { cancel, isCancel, select } from "@clack/prompts";
import { Flags } from "@oclif/core";
import { consola } from "consola";

import { createZitadelClient, type ZitadelClient } from "../api-client";
import { assertEnvironmentName, listEnvironmentNames } from "../environment";
import { ZitadelError } from "../errors";
import { readZitadelSecret } from "../project";
import { BaseCommand } from "./base";
import type { GlobalOptions } from "./types";

/**
 * The prompt's answer for the project level. Parentheses fall outside the
 * environment-name grammar, so no environment can ever be named this — and a
 * string, unlike a symbol, survives `isCancel`'s narrowing, which types every
 * symbol as the cancel signal.
 */
const PROJECT_LEVEL = "(project-level)";

/**
 * A command that addresses one owner on the platform: an environment, or the
 * project level. Owners are separate rather than a ladder — nothing an owner
 * holds reaches another (ADR 062 §4) — so a value meant for `prod` has to be
 * written on `prod`, and the target must never be picked by accident.
 *
 * The owner is therefore never defaulted. `--environment` names one and
 * `--project-level` names the project; with neither, a person is asked and an
 * agent or CI run is refused, the rule ADR 035 sets for `deploy`. Leaving the
 * flag off cannot quietly land a value where no environment will read it.
 */
export abstract class EnvironmentCommand extends BaseCommand {
  static override baseFlags = {
    ...BaseCommand.baseFlags,
    environment: Flags.string({
      char: "e",
      aliases: ["env"],
      description: "Environment to address, by name.",
      exclusive: ["project-level"],
    }),
    "project-level": Flags.boolean({
      description:
        "Address the project level instead of an environment. Environments do not inherit project-level values.",
      exclusive: ["environment"],
    }),
  };

  /** The `--environment` value, validated; `undefined` when none was passed. */
  private requestedEnvironment?: string;

  /** Whether `--project-level` was passed. */
  private projectLevel = false;

  /**
   * Validate the owner flags, then build the invocation context.
   *
   * `--environment` names an owner on the one instance the CLI talks to; it
   * plays no part in choosing that instance.
   */
  protected override async toMeta(
    flags: Record<string, unknown>,
    options: { resolveServer?: boolean; source?: string } = {},
  ): Promise<GlobalOptions> {
    if (typeof flags.environment === "string") {
      assertEnvironmentName(flags.environment);
      this.requestedEnvironment = flags.environment;
    }
    this.projectLevel = flags["project-level"] === true;
    return super.toMeta(flags, options);
  }

  /**
   * Open the platform connection and settle the owner, the counterpart of the
   * resource commands' `connect`.
   *
   * Which project and server the command is about is worth stating to a person,
   * but those lines share stdout with the result, so they are printed only on a
   * terminal: on a pipe the result travels alone, and `--json` silences them
   * either way.
   */
  protected async connect(): Promise<
    Readonly<{
      client: ZitadelClient;
      /** The query parameters every variables endpoint takes for this owner. */
      scope: Readonly<{ project_id: string; environment_name?: string }>;
      /** The environment addressed, or `undefined` for the project level. */
      environment: string | undefined;
    }>
  > {
    const { cwd, source } = this.meta;
    const secret = await readZitadelSecret(cwd);
    if (process.stdout.isTTY) {
      consola.info(`Project   ${secret.project_id}`);
      consola.info(`Server    ${source}`);
    }
    const client = createZitadelClient({ baseUrl: source, token: secret.project_secret });
    const environment = await this.resolveOwner(client, secret.project_id);
    return {
      client,
      environment,
      scope: {
        project_id: secret.project_id,
        ...(environment === undefined ? {} : { environment_name: environment }),
      },
    };
  }

  /**
   * The owner this invocation addresses: an environment's name, or `undefined`
   * for the project level. Asks a person when neither flag was passed, and
   * refuses a non-interactive run, naming the environments the project has.
   */
  protected async resolveOwner(
    client: ZitadelClient,
    projectId: string,
  ): Promise<string | undefined> {
    if (this.projectLevel) {
      return undefined;
    }
    if (this.requestedEnvironment !== undefined) {
      return this.requestedEnvironment;
    }
    if (this.meta.nonInteractive) {
      // The names only enrich the refusal. If listing them fails, the refusal
      // still has to be about the missing owner — not a network error that
      // hides it.
      const environments = await listEnvironmentNames(client, projectId).catch(() => []);
      throw new ZitadelError(
        "E_VALIDATION",
        "Name the owner: --environment <name>, or --project-level",
        {
          hint:
            environments.length > 0
              ? `Environments do not inherit project-level values. This project's environments: ${environments.join(", ")}.`
              : "Environments do not inherit project-level values.",
        },
      );
    }
    const environments = await listEnvironmentNames(client, projectId);
    const choice = await select<string>({
      message: "Which environment?",
      options: [
        ...environments.map((name) => ({ value: name, label: name })),
        {
          value: PROJECT_LEVEL,
          label: "The project level",
          hint: "not inherited by any environment",
        },
      ],
    });
    if (isCancel(choice)) {
      cancel("Cancelled.");
      throw new ZitadelError("E_VALIDATION", "No owner chosen");
    }
    return choice === PROJECT_LEVEL ? undefined : choice;
  }
}
