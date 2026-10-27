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
import { buildRequest, pathValuesOf, readInput, urlOf } from "../../lib/api/request";
import { ZitadelError } from "../../lib/errors";
import { LocalServer } from "../../lib/local-server/server";
import { BaseCommand, CommandGroups, type JsonEnvelope, nonBlankString } from "../../lib/oclif";
import { readZitadelSecret } from "../../lib/project";
import { Promptable } from "../../lib/oclif/promptable";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * `zitadel api` — call any operation of the Zitadel API with the server and
 * project secret every other command uses: the escape hatch for what no
 * resource command covers yet, as `gh api` and `vercel api` are for theirs.
 *
 * The operations are the spec's (`@zitadel/api/generated/operations`), so an
 * operation is named by its `operationId` or found by its path, a field is
 * typed by the operation's schema, and `--paginate` knows where the cursor
 * goes. `--json`'s `data` is the response body as the API reference documents
 * it.
 */
export default class Api extends Promptable(BaseCommand) {
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
    method: Flags.string({
      char: "X",
      description: "The HTTP method, to choose among a path's operations.",
      helpValue: METHODS.join("|"),
      // In any case, as curl takes it: oclif's `options` would refuse `-X delete`.
      parse: async (input) => {
        const method = input.toUpperCase();
        if (!(METHODS as readonly string[]).includes(method)) {
          throw new ZitadelError("E_VALIDATION", `-X ${input} is not one of ${METHODS.join(", ")}`);
        }
        return method;
      },
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
  };

  async run(): Promise<JsonEnvelope> {
    const { args, argv, flags } = await this.parse(Api);
    const meta = await this.toMeta(flags);

    const ref = args.operation ?? (await this.chooseOperation());
    const target = resolveTarget(ref, flags.method);
    const { operation } = target;
    const refusal = uncallable(operation);
    if (refusal) {
      throw new ZitadelError("E_VALIDATION", refusal, {
        hint: "Call it from the app it belongs to, through the SDK; `zitadel api ls` marks what the CLI can call.",
      });
    }
    if (flags.paginate && operation.paging === null) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${operation.id} does not page, so --paginate has nothing to follow`,
        {
          hint: "Leave out --paginate.",
        },
      );
    }
    this.recordTelemetry({ operation: operation.id, is_paginated: flags.paginate });

    // An operation that needs no credential runs anywhere; one that does
    // needs the project `zitadel setup` wrote. Either way a project at hand
    // fills a `project_id` left out.
    const secret =
      operation.auth === "secret"
        ? await readZitadelSecret(meta.cwd)
        : await readZitadelSecret(meta.cwd).catch(() => undefined);
    const positionals = (argv as string[]).slice(args.operation === undefined ? 0 : 1);
    const pathValues = await this.pathValues(target, positionals, secret?.project_id);
    const request = buildRequest({
      target,
      pathValues,
      fields: flags.field ?? [],
      input: await readInput(flags.input),
      projectId: secret?.project_id,
    });

    if (meta.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          operation: operation.id,
          method: operation.method,
          url: urlOf(meta.source, request),
          ...(request.body === undefined ? {} : { body: request.body }),
        },
        pretty: curlOf(meta.source, request),
      });
    }

    await LocalServer.assertCurrent(meta.cwd, meta.source, {
      cliVersion: meta.cliVersion,
      env: meta.env,
    });
    // As the resource commands do: say which server is called, on a terminal
    // only, so a pipe receives the response alone.
    if (process.stdout.isTTY) {
      consola.info(`${operation.method} ${urlOf(meta.source, request)}`);
    }
    const token = operation.auth === "secret" ? secret?.project_secret : undefined;
    const response = flags.paginate
      ? await sendAll(meta.source, token, request)
      : await send(meta.source, token, request);
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
  private async chooseOperation(): Promise<string> {
    const callable = OPERATIONS.filter((operation) => uncallable(operation) === undefined);
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
    positionals: readonly string[],
    projectId: string | undefined,
  ): Promise<Readonly<Record<string, string>>> {
    const { values, missing } = pathValuesOf(target, positionals, projectId);
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
