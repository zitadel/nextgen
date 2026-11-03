import { Args, Flags } from "@oclif/core";
import { consola } from "consola";

import { sendAll, send } from "../../lib/api/call";
import { curlOf } from "../../lib/api/curl";
import {
  type ApiOperation,
  OPERATIONS,
  resolveTarget,
  type Target,
  uncallable,
} from "../../lib/api/operations";
import { type PathValues, urlOf, withPathValues } from "../../lib/api/request";
import type { ZitadelSecret } from "../../lib/project";
import {
  type Admitted,
  BaseCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "../../lib/oclif";
import { methodFlag } from "./flags/method";
import { apiForce } from "./requirements/force";
import { apiOperation } from "./requirements/operation";
import { apiPaging } from "./requirements/paging";
import { apiPath, pathValuesFromWords } from "./requirements/path";
import { apiPayload, requestOf } from "./requirements/payload";
import { apiSecret } from "./requirements/secret";
import { Destructive } from "../../lib/oclif/destructive";

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
  static override group = CommandGroups.diagnostics;
  static override description =
    "Call any operation of the Zitadel API, with this project's server and project secret.";
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
    method: methodFlag({
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

  static override requires = {
    operation: apiOperation,
    paging: apiPaging,
    secret: apiSecret,
    path: apiPath,
    payload: apiPayload,
    force: apiForce,
  };

  protected async execute({
    argv,
    args,
    flags,
    operation: chosen,
    secret: { secret },
    path,
    payload,
  }: Admitted<typeof Api>): Promise<JsonEnvelope> {
    // Only a prompted operation is resolved here: a requirement cannot ask, so
    // the one the command line named brought its path values and request with it.
    const prompted = chosen.target === undefined;
    const target =
      chosen.target ?? resolveTarget(await this.chooseOperation(flags.paginate, secret));
    const { operation } = target;
    this.recordTelemetry({ operation: operation.id, is_paginated: flags.paginate });

    const given = prompted
      ? pathValuesFromWords(target, argv, args.operation !== undefined, secret?.project_id)
      : path;
    const request = withPathValues(
      payload.request ?? (await requestOf(target, flags, secret?.project_id)),
      await this.pathValues(target, given),
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
    if (process.stdout.isTTY) {
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
      return this.emit({ status: "skipped", reason: "call-cancelled" });
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
          ? process.stdout.isTTY
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
