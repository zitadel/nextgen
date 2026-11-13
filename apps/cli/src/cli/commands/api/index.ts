import { Args, Flags } from "@oclif/core";
import { z } from "zod";

import {
  buildRequest,
  type PathValues,
  pathValuesOf,
  readInput,
  withPathValues,
} from "@/lib/api-request";
import {
  type ApiRequest,
  type ApiResponse,
  createZitadelClient,
  InvalidError,
  Operation,
  OperationService,
  type Target,
  type ZitadelClient,
} from "@/lib/backend";
import { CANCELLED, ZitadelError } from "@/lib/errors";
import { log } from "@/lib/log";
import { DEFAULT_SERVER } from "@/lib/server";
import {
  type Admitted,
  CommandGroups,
  CREDENTIALS,
  EnvironmentCommand,
  type JsonEnvelope,
  nonBlankString,
} from "@/lib/oclif";
import { Destructive } from "@/lib/oclif/destructive";
import { reads, type Refused } from "@/lib/oclif/flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { json, prose, type Rendering } from "@/lib/oclif/rendering";
import { escapeControlCharacters } from "@/lib/terminal-text";
import type { Summary } from "@/lib/ui";
import { userAgent } from "@/lib/user-agent";

/** The HTTP methods `zitadel api` sends. */
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * The HTTP method `-X` names, in any case as curl takes it: oclif's `options`
 * would refuse `-X delete`, so the value is upper-cased before the set decides
 * it. It refuses a method the CLI does not send.
 */
const METHOD = {
  schema: z
    .string()
    .transform((method) => {
      return method.toUpperCase();
    })
    .pipe(z.enum(HTTP_METHODS)),
  refusal: {
    message: `-X {value} is not one of ${HTTP_METHODS.join(", ")}`,
  },
} as const satisfies Refused<string>;

const UNCALLABLE_REFUSAL = {
  message: "{reason}",
  hint: "Call it from the app it belongs to, through the SDK; the api ls command marks what the CLI can call.",
  next: [{ id: "api:ls" }],
} as const satisfies Refusal;

const NOTHING_TO_PAGE_REFUSAL = {
  message: "{operation} does not page, so --paginate has nothing to follow",
  hint: "Leave out --paginate.",
} as const satisfies Refusal;

const FORCE_REQUIRED_REFUSAL = {
  code: "E_CONFIRMATION_REQUIRED",
  message: "Cannot call {operation} without --force in non-interactive mode",
  hint: "Ask a person first: {question} Once they agree, run the same command again, with its --field values or the pipe into --input, and add --force.",
  details: { question: "{question}" },
} as const satisfies Refusal;

/**
 * The operation an operation id or a path names, or the refusal that says how to
 * list them.
 */
function resolveTarget(ref: string, method?: string): Target {
  try {
    return Operation.named(ref, method);
  } catch (error) {
    if (error instanceof InvalidError) {
      throw new ZitadelError("E_VALIDATION", error.message, {
        hint: error.hint,
        nextCommands: [{ id: "api:ls", flags: { json: true } }],
      });
    }
    throw error;
  }
}

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
  const reason = target.operation.uncallable;
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
 * Where a call goes, the project a `project_id` left out is filled from, and
 * the client that sends it.
 */
type Reach = Readonly<{
  server: string;
  projectId: string | undefined;
  client: ZitadelClient;
}>;

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
  flags: Readonly<{
    field?: readonly string[];
    input?: string;
  }>,
  projectId: string | undefined,
): Promise<ApiRequest> {
  return buildRequest({
    target,
    fields: flags.field ?? [],
    input: await readInput(flags.input),
    projectId,
  });
}

/**
 * Refuses a destructive call nobody can be asked about. An operation that
 * deletes, revokes or rolls back asks first; with a body it cannot name a
 * retry, since a body can hold a secret or have come from a pipe a rerun of
 * the command alone would not have, so the refusal says what to do instead. A
 * dry run calls nothing, so it asks nothing.
 *
 * @param request - The call.
 * @param run - Whether the run may be asked, forced or only previews.
 * @param question - What a person would be asked, which the refusal repeats.
 */
export function refuseUnforced(
  request: ApiRequest,
  run: { dryRun: boolean; nonInteractive: boolean; force: boolean },
  question: string,
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
      question,
    });
  }
}

/** A shell word, single-quoted. */
function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The api command — call any operation of the Zitadel API with the server and
 * project secret every other command uses: the escape hatch for what no
 * resource command covers yet, as `gh api` and `vercel api` are for theirs.
 * Both come from the same environment, so the secret only ever goes to the
 * server its project belongs to.
 *
 * The operations are the spec's (`@zitadel/api/generated/operations`), so an
 * operation is named by its `operationId` or found by its path, a field is
 * typed by the operation's schema, and `--paginate` knows where the cursor
 * goes. `--json`'s `data` is the response body as the API reference documents
 * it. An operation that deletes, revokes or rolls back asks first, as the
 * command that covers it does.
 */
export default class Api extends Destructive(EnvironmentCommand) {
  static override description =
    "Call any operation of the Zitadel API, with this project's server and project secret.";
  static override group = CommandGroups.diagnostics;

  static override examples = [
    "<%= config.bin %> api queryUsers -F limit=5",
    "<%= config.bin %> api getUser user_01JZ8Y3V4Q0K7N2M5P6R8S9T0W",
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
    const { args, flags } = await this.parseOnce();
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
      pretty: prose(""),
      summary: {
        title: "Done",
        sections: [],
      },
      // Built here, as the run was not admitted: it has no directory of its own to put back.
      next: this.jsonEnabled()
        ? {
            commands: [
              this.suggestWith(typeof flags.cwd === "string" ? { cwd: flags.cwd } : {})({
                id: "api:ls",
              }),
            ],
          }
        : undefined,
    });
  }

  protected async execute({ argv, args, flags }: Admitted<typeof Api>): Promise<JsonEnvelope> {
    const named = readOperation(args.operation, flags.method);
    refuseUnpaged(named, flags.paginate);

    const target = named ?? resolveTarget(await this.chooseOperation(flags.paginate));
    const { operation } = target;
    this.recordTelemetry({
      operation: operation.id,
      is_paginated: flags.paginate,
    });
    const { server, projectId, client } = await this.reach(operation);

    const built = await requestOf(target, flags, projectId);
    // The question a person is asked, and the one a refusal hands to whoever must ask them.
    const question = [
      `Call ${operation.id}${
        projectId === undefined ? "" : ` in project ${projectId}`
      } on ${server.replace(/^https?:\/\//, "")}?`,
      ...(operation.summary === "" ? [] : [`${operation.summary}.`]),
    ].join(" ");
    refuseUnforced(built, this.meta, question);
    const request = withPathValues(
      built,
      await this.pathValues(
        target,
        pathValuesFromWords(target, argv, args.operation !== undefined, projectId),
      ),
    );

    const url = operation.urlOn(server, request);
    if (this.dryRun) {
      const curl = prose(this.curlFor(request, server));
      const title = `Would call ${operation.id} (dry run)`;

      return this.emit({
        status: "ok",
        data: {
          title,
          dry_run: true,
          operation: operation.id,
          method: operation.method,
          url,
          ...(request.body === undefined
            ? {}
            : {
                body: request.body,
              }),
        },
        pretty: curl,
        summary: {
          title,
          sections: [],
          lines: curl.text.split("\n"),
        },
      });
    }

    // As the resource commands do: say which server is called, on a terminal
    // only, so a pipe receives the response alone.
    if (this.isOnScreen) {
      log.info(`${operation.method} ${escapeControlCharacters(String(url))}`);
    }
    const destructive = request.operation.destructive;
    const consent = destructive
      ? await this.consent({
          verb: "call",
          name: `call ${operation.id}`,
          message: question,
          // A body is not repeated in a suggestion: it can hold a secret, or
          // have come from a pipe a rerun of the command alone would not have.
          ...(request.body === undefined
            ? {}
            : {
                retry: undefined,
              }),
        })
      : undefined;
    if (destructive && consent === undefined) {
      return this.emit({
        status: "skipped",
        reason: "call-cancelled",
        summary: {
          title: CANCELLED,
          sections: [],
          lines: [`${operation.id} was not called.`],
        },
      });
    }
    const operationService = new OperationService(
      consent === undefined ? client : consent.unlock(client),
    );
    const response = flags.paginate
      ? await operationService.callAll(request)
      : await operationService.call(request);

    const answer = this.answered(operation.id, response);

    return this.emit({
      status: "ok",
      data: response.body ?? null,
      verbatim: true,
      ...(answer.pretty === undefined ? {} : { pretty: answer.pretty }),
      summary: answer.summary,
    });
  }

  /**
   * What the call answered: the ending a person at a terminal sees, and the
   * rendering a pipe is given when that differs from it.
   *
   * A JSON body is spelled the way JSON spells a control character, because
   * this is the command a script pipes into `jq`: the terminal spelling would
   * write `\x9b` for a C1 character, which is not an escape JSON has, and the
   * body would not parse. A text body and the note about an empty one are a
   * person's to read, so they take the spelling a person reads. The body is
   * the server's, not the CLI's, so the ending writes it as it came instead of
   * folding it to the width of the terminal.
   *
   * @param operationId - The operation that was called.
   * @param response - The answer the call got.
   * @returns The ending, and the rendering when a script is given something else.
   */
  private answered(
    operationId: string,
    response: ApiResponse,
  ): { summary: Summary; pretty?: Rendering } {
    if (response.body === undefined) {
      return {
        summary: {
          title: `No content (${response.status})`,
          sections: [],
        },
        ...(this.isOnScreen ? {} : { pretty: prose("") }),
      };
    }
    const pretty = typeof response.body === "string" ? prose(response.body) : json(response.body);
    return {
      summary: {
        title: `Called ${operationId}`,
        sections: [],
        lines: pretty.text.split("\n"),
      },
      ...(this.isOnScreen ? {} : { pretty }),
    };
  }

  /**
   * The server, project and client a call to `operation` uses. One that needs
   * the project secret takes all three from the environment, as every other
   * command does, and is refused, naming the variable, when one is missing:
   * the secret is never sent to a server its project did not name. One that
   * needs no credential runs anywhere: against the project's server when the
   * environment names one, else against the cloud, with no project to fill in.
   */
  private async reach(operation: Operation): Promise<Reach> {
    if (operation.auth === "secret") {
      return this.connect();
    }
    const { values } = this.environment;
    const named = values.ZITADEL_URL?.value;
    const server = named ?? DEFAULT_SERVER;
    const projectId = named === undefined ? undefined : values.ZITADEL_PROJECT_ID?.value;
    this.ui.ranAgainst(projectId, server);
    return {
      server,
      projectId,
      client: createZitadelClient({
        userAgent: userAgent(),
        baseUrl: server,
        token: undefined,
        signal: this.signal,
      }),
    };
  }

  /**
   * Choose an operation the CLI can call: its part of the API, then the
   * operation. One that needs the project secret is offered only where the
   * environment has one.
   */
  private async chooseOperation(paginate: boolean): Promise<string> {
    const hasSecret = this.environment.values[CREDENTIALS.project] !== undefined;
    const callable = Operation.all().filter((operation) => {
      return (
        operation.uncallable === undefined &&
        (!paginate || operation.paging !== null) &&
        (operation.auth !== "secret" || hasSecret)
      );
    });
    const retry = this.suggest({ id: "api:ls", flags: { json: true } });
    const tags = [
      ...new Set(
        callable.map((operation) => {
          return operation.tag;
        }),
      ),
    ];
    const tag = await this.ask.select({
      name: "operation",
      message: "Which part of the API would you like to use?",
      retry,
      options: tags.map((value) => {
        return {
          value,
          label: value,
        };
      }),
    });
    return this.ask.select({
      name: "operation",
      message: "Which operation would you like to run?",
      retry,
      options: callable
        .filter((operation) => {
          return operation.tag === tag;
        })
        .map((operation) => {
          return {
            value: operation.id,
            label: `${operation.method} ${operation.path}`,
            hint: operation.summary,
          };
        }),
    });
  }

  /** Every path parameter's value, asking for the ones the command line left out. */
  private async pathValues(
    target: Target,
    { values, missing }: PathValues,
  ): Promise<Readonly<Record<string, string>>> {
    const filled: Record<string, string> = { ...values };
    const placeholders = missing.map((each) => {
      return `<${each}>`;
    });
    for (const name of missing) {
      filled[name] = await this.ask.text({
        name,
        message: `What is the value of ${name}?`,
        // The path parameters follow the operation as arguments the command
        // does not declare one by one, so the run is repeated as typed with them added.
        retry: await this.rerun({ arguments: [target.operation.id, ...placeholders] }),
        parse: (value: string) => {
          const typed = value.trim();
          if (typed === "") {
            return {
              ok: false as const,
              problem: `${name} cannot be empty`,
            };
          }
          return {
            ok: true as const,
            value: typed,
          };
        },
      });
    }
    return filled;
  }

  /**
   * The cURL command that sends a request, which a dry run prints. The project
   * secret is never written out: an operation that needs it reads it from
   * `$ZITADEL_PROJECT_SECRET`, as the API reference's cURL samples do, in
   * double quotes so the shell expands it.
   *
   * @param request - The request.
   * @param server - The server it is sent to.
   * @returns The command.
   */
  private curlFor(request: ApiRequest, server: string): string {
    return [
      `curl -X ${request.operation.method} ${quote(request.operation.urlOn(server, request))}`,
      ...(request.operation.auth === "secret"
        ? ['-H "Authorization: Bearer $ZITADEL_PROJECT_SECRET"']
        : []),
      ...(request.body === undefined
        ? []
        : ["-H 'Content-Type: application/json'", `-d ${quote(JSON.stringify(request.body))}`]),
    ].join(" \\\n  ");
  }
}
