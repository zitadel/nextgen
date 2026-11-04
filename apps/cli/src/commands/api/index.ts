import { Args, Flags } from "@oclif/core";
import { z } from "zod";
import { consola } from "consola";

import { sendAll, send } from "../../lib/raw-api/call";
import { curlOf } from "../../lib/raw-api/curl";
import {
  type ApiOperation,
  OPERATIONS,
  resolveTarget,
  type Target,
  uncallable,
} from "../../lib/raw-api/operations";
import {
  type ApiRequest,
  buildRequest,
  type PathValues,
  pathValuesOf,
  readInput,
  urlOf,
  withPathValues,
} from "../../lib/raw-api/request";
import { readZitadelSecret, type ZitadelSecret } from "../../lib/project";
import {
  type Admitted,
  BaseCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "../../lib/oclif";
import { reads, type Refused } from "../../lib/oclif/flags";
import { type Refusal, refusalError } from "../../lib/oclif/refusal";
import { Destructive } from "../../lib/oclif/destructive";

/** The HTTP methods `zitadel api` sends. */
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * The HTTP method `-X` names, in any case as curl takes it: oclif's `options`
 * would refuse `-X delete`, so the value is upper-cased before the set decides
 * it. It refuses a method the CLI does not send.
 */
const METHOD: Refused<string> = {
  schema: z
    .string()
    .transform((method) => {
      return method.toUpperCase();
    })
    .pipe(z.enum(HTTP_METHODS)),
  refusal: {
    message: `-X {value} is not one of ${HTTP_METHODS.join(", ")}`,
  },
};

const UNCALLABLE_REFUSAL: Refusal = {
  message: "{reason}",
  hint: "Call it from the app it belongs to, through the SDK; `zitadel api ls` marks what the CLI can call.",
};

const NOTHING_TO_PAGE_REFUSAL: Refusal = {
  message: "{operation} does not page, so --paginate has nothing to follow",
  hint: "Leave out --paginate.",
};

const FORCE_REQUIRED_REFUSAL: Refusal = {
  message: "Cannot call {operation} without --force in non-interactive mode",
  hint: "Run the same command again, with its --field values or the pipe into --input, and add --force.",
};

/**
 * The operation the command line points at: an operation id or a path, with
 * `-X` choosing among a path's methods. It refuses one the spec does not have
 * and one the CLI cannot call, because only an end user's session cookie
 * authenticates it. `undefined` is an operation left to be chosen from a list.
 */
export function readOperation(
  ref: string | undefined,
  method: string | undefined,
): Target | undefined {
  if (ref === undefined) {
    return undefined;
  }
  const target = resolveTarget(ref, method);
  const reason = uncallable(target.operation);
  if (reason !== undefined) {
    throw refusalError(UNCALLABLE_REFUSAL, {
      reason,
    });
  }
  return target;
}

/**
 * Refuses `--paginate` on an operation with no cursor to follow. One still to
 * be chosen takes it, because only callable paging operations are then offered.
 */
export function refuseUnpaged(target: Target | undefined, paginate: boolean): void {
  if (paginate && target !== undefined && target.operation.paging === null) {
    throw refusalError(NOTHING_TO_PAGE_REFUSAL, {
      operation: target.operation.id,
    });
  }
}

/**
 * The project the operation is called on behalf of, when there is one. An
 * operation that needs no credential runs anywhere; one that does needs the
 * project `zitadel setup` wrote, and is refused without it. Either way a
 * project at hand fills a `project_id` left out, and with the operation still
 * to be chosen a missing project only narrows what can be chosen.
 */
export async function readProjectSecret(
  target: Target | undefined,
  cwd: string,
): Promise<ZitadelSecret | undefined> {
  if (target?.operation.auth === "secret") {
    return readZitadelSecret(cwd);
  }
  return readZitadelSecret(cwd).catch(() => undefined);
}

/**
 * Every path parameter's value the command line gives: from the path itself
 * when the target was a path, else from the words after the operation in the
 * order the path has them, with a `project_id` left out filled from the project
 * at hand. It refuses a word too many, and one given both in the path and as an
 * argument. The names still without a value are asked for, so they are
 * reported rather than refused.
 */
export function pathValuesFromWords(
  target: Target,
  argv: readonly string[],
  named: boolean,
  projectId: string | undefined,
): PathValues {
  return pathValuesOf(target, argv.slice(named ? 1 : 0), projectId);
}

/**
 * `--field` and `--input` laid over the operation's schema, each typed by it.
 * It refuses a field the operation does not take, a value of the wrong type, a
 * body on an operation that takes none, and `--input -` with nothing piped in.
 */
export async function requestOf(
  target: Target,
  flags: Readonly<Record<string, unknown>>,
  projectId: string | undefined,
): Promise<ApiRequest> {
  return buildRequest({
    target,
    fields: (flags.field as readonly string[] | undefined) ?? [],
    input: await readInput(flags.input as string | undefined),
    projectId,
  });
}

/**
 * Refuses a destructive call nobody can be asked about. An operation that
 * deletes, revokes or rolls back asks first; with a body it cannot name a
 * retry, since a body can hold a secret or have come from a pipe a rerun of
 * the command alone would not have, so the refusal says what to do instead. A
 * dry run calls nothing, so it asks nothing.
 */
export function refuseUnforced(
  request: ApiRequest,
  run: { dryRun: boolean; nonInteractive: boolean; force: boolean },
): void {
  const asks =
    request.operation.destructive &&
    request.body !== undefined &&
    run.nonInteractive &&
    !run.force &&
    !run.dryRun;
  if (asks) {
    throw refusalError(FORCE_REQUIRED_REFUSAL, {
      operation: request.operation.id,
    });
  }
}

/**
 * `zitadel api` — call any operation of the Zitadel API with the server and
 * project secret every other command uses: the escape hatch for what no
 * resource command covers yet, as `gh api` and `vercel api` are for theirs.
 *
 * The operations are the spec's (`@zitadel/api/generated/operations`), so an
 * operation is named by its `operationId` or found by its path, a field is
 * typed by the operation's schema, and `--paginate` knows where the cursor
 * goes. `--json`'s `data` is the response body as the API reference documents
 * it. An operation that deletes, revokes or rolls back asks first, as the
 * command that covers it does.
 */
export default class Api extends Destructive(BaseCommand) {
  static override description =
    "Call any operation of the Zitadel API, with this project's server and project secret.";
  static override group = CommandGroups.diagnostics;
  static override examples = [
    "<%= config.bin %> api queryUsers -F limit=5",
    "<%= config.bin %> api GetUserByID user_01JZ8Y3V4Q0K7N2M5P6R8S9T0W",
    "<%= config.bin %> api /users/user_01JZ8Y3V4Q0K7N2M5P6R8S9T0W/passkeys --json",
    "<%= config.bin %> api listEvents -F category=auth --paginate --json",
    "<%= config.bin %> api createTeam -F name=Support --dry-run",
    "<%= config.bin %> api createTeam --input - < team.json",
  ];
  // The path parameters follow the operation as further arguments.
  static override strict = false;
  static override args = {
    operation: Args.string({
      description:
        "An operationId (queryUsers) or a path (/users/query), then the path parameters. Omit it to choose one.",
    }),
  };
  static override flags = {
    method: Flags.custom<string>({
      helpValue: HTTP_METHODS.join("|"),
      parse: reads(METHOD),
    })({
      char: "X",
      description: "The HTTP method, to choose among a path's operations.",
    }),
    field: Flags.string({
      char: "F",
      description:
        "A field: name=value, or name:=json for JSON, typed by the operation's schema. A query parameter's name sets it; any other name is a dot path into the body. Repeatable.",
      multiple: true,
      multipleNonGreedy: true,
    }),
    input: nonBlankString({
      description: "Read the JSON body from a file, or from stdin with -. --field lays over it.",
    }),
    paginate: Flags.boolean({
      description:
        "Follow next_page_token to the last page, and answer with every page's items in one list.",
    }),
    force: Flags.boolean({
      char: "f",
      description:
        "Call an operation that deletes, revokes or rolls back without the confirmation prompt. Required when non-interactive.",
    }),
  };

  /**
   * No operation is called help, so the word asks for this command's help as
   * `--help` does. It answers before the run is admitted, because help needs
   * neither a resolved server nor an operation, and the operation this command
   * requires would refuse `help` as a name it does not know.
   */
  override async run(): Promise<JsonEnvelope> {
    const { args } = await this.parseOnce();
    if (args.operation?.toLowerCase() !== "help") {
      return super.run();
    }
    // Only the command's name is needed for the envelope: `toMeta` would also
    // open telemetry and the first-run notice, which `--help` does not.
    this.meta = {
      ...this.meta,
      command: this.id ?? this.meta.command,
    };
    if (!this.jsonEnabled()) {
      await this.config.runCommand("help", [Api.id]);
    }

    return this.emit({
      status: "ok",
      data: {},
      next: this.jsonEnabled() ? { commands: [this.suggestUnscoped("api ls")] } : undefined,
      pretty: "",
    });
  }

  protected async execute({ argv, args, flags }: Admitted<typeof Api>): Promise<JsonEnvelope> {
    const named = readOperation(args.operation, flags.method);
    refuseUnpaged(named, flags.paginate);
    const secret = await readProjectSecret(named, this.cwd);

    const target = named ?? resolveTarget(await this.chooseOperation(flags.paginate, secret));
    const { operation } = target;
    this.recordTelemetry({ operation: operation.id, is_paginated: flags.paginate });

    const built = await requestOf(target, flags, secret?.project_id);
    refuseUnforced(built, this.meta);
    const request = withPathValues(
      built,
      await this.pathValues(
        target,
        pathValuesFromWords(target, argv, args.operation !== undefined, secret?.project_id),
      ),
    );

    if (this.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          operation: operation.id,
          method: operation.method,
          url: urlOf(this.meta.source, request),
          ...(request.body === undefined ? {} : { body: request.body }),
        },
        pretty: curlOf(this.meta.source, request),
      });
    }

    // As the resource commands do: say which server is called, on a terminal
    // only, so a pipe receives the response alone.
    if (this.isOnScreen) {
      consola.info(`${operation.method} ${urlOf(this.meta.source, request)}`);
    }
    const destructive = request.operation.destructive;
    const consent = destructive
      ? await this.consent({
          verb: "call",
          name: `call ${operation.id}`,
          message: [
            `Would you like to call ${operation.id} at ${urlOf(this.meta.source, request)}?`,
            ...(operation.summary === "" ? [] : [`${operation.summary}.`]),
          ].join(" "),
          // A body is not repeated in a suggestion: it can hold a secret, or
          // have come from a pipe a rerun of the command alone would not have.
          ...(request.body === undefined ? {} : { retry: undefined }),
        })
      : undefined;
    if (destructive && consent === undefined) {
      return this.emit({
        status: "skipped",
        reason: "call-cancelled",
      });
    }
    const token = operation.auth === "secret" ? secret?.project_secret : undefined;
    const response = flags.paginate
      ? await sendAll(this.meta.source, token, request, this.signal)
      : await send(this.meta.source, token, request, this.signal, consent);

    return this.emit({
      status: "ok",
      data: response.body ?? null,
      pretty:
        response.body === undefined
          ? this.isOnScreen
            ? `No content (${response.status}).`
            : ""
          : typeof response.body === "string"
            ? response.body
            : JSON.stringify(response.body, null, 2),
    });
  }

  /** Choose an operation the CLI can call: its part of the API, then the operation. */
  private async chooseOperation(
    paginate: boolean,
    secret: ZitadelSecret | undefined,
  ): Promise<string> {
    const callable = OPERATIONS.filter(
      (operation) =>
        uncallable(operation) === undefined &&
        (!paginate || operation.paging !== null) &&
        (operation.auth !== "secret" || secret !== undefined),
    );
    const retry = this.suggestUnscoped("api ls --json");
    const tag = await this.input({
      kind: "select",
      name: "operation",
      message: "Which part of the API would you like to use?",
      retry,
      options: [...new Set(callable.map((operation) => operation.tag))].map((value) => ({
        value,
        label: value,
      })),
    });
    return this.input({
      kind: "select",
      name: "operation",
      message: "Which operation would you like to run?",
      retry,
      options: callable
        .filter((operation) => operation.tag === tag)
        .map((operation: ApiOperation) => ({
          value: operation.id,
          label: `${operation.method} ${operation.path}`,
          hint: operation.summary,
        })),
    });
  }

  /** Every path parameter's value, asking for the ones the command line left out. */
  private async pathValues(
    target: Target,
    { values, missing }: PathValues,
  ): Promise<Readonly<Record<string, string>>> {
    const filled: Record<string, string> = { ...values };
    for (const name of missing) {
      filled[name] = await this.input({
        kind: "text",
        name,
        message: `What is the value of ${name}?`,
        retry: this.suggestUnscoped(
          `api ${target.operation.id} ${missing.map((each) => `<${each}>`).join(" ")}`,
        ),
        parse: (value: string) =>
          value.trim() === ""
            ? { ok: false as const, problem: `${name} cannot be empty` }
            : { ok: true as const, value: value.trim() },
      });
    }
    return filled;
  }
}
