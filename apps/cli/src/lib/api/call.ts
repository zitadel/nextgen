import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";

import { z } from "zod";

import { ZitadelError } from "@/lib/errors";
import { read, type Refused } from "@/lib/oclif/flags";
import { parseJsonObject } from "@/lib/json";
import type { ApiRequest, Operation, Target } from "@/lib/backend";
import * as schemas from "@/lib/backend/schemas";
import { fragmentOf, readAssignment } from "@/lib/oclif/crud/assign";
import { mergeDocuments, typedValue } from "@/lib/oclif/crud/document";
import { describeBody } from "@/lib/oclif/crud/fields";
import type { Schema } from "@/lib/oclif/crud/types";
import { nodeAt, unwrap, type ZodLike } from "@/lib/oclif/crud/zod";
import type { Suggested } from "@/lib/suggestion";

/** The flag a field is given with, which errors name. */
const FIELD = "--field";

/**
 * What a path value may be, as an id may: not blank, not `.` or `..`, which a
 * URL resolves as a step up the path, and without a control character.
 */
const SAFE_ID = {
  schema: z
    .string()
    .trim()
    .refine((id) => {
      return id !== "" && id !== "." && id !== ".." && !/\p{Cc}/u.test(id);
    }, "it must be an id: not blank, not . or .., and no control character"),
  refusal: {
    message: "Invalid {input}: {problem}",
    hint: "Pass the value exactly as it was listed.",
    details: {
      argument: "{input}",
    },
  },
} as const satisfies Refused<string>;

/** Path parameter values read so far, and the names still without one. */
export type PathValues = Readonly<{
  values: Readonly<Record<string, string>>;
  missing: readonly string[];
}>;

/** What a request is built from. */
export type RequestInput = Readonly<{
  /** `--field` entries, in the order given. */
  fields: readonly string[];
  /**
   * The `--file` document, when one was given.
   */
  input?: Readonly<Record<string, unknown>>;
  /** The CLI's project, for a required `project_id` the caller leaves out. */
  projectId?: string;
}>;

/**
 * One `zitadel api` call: an operation the user named, from which the request
 * is built out of `--field` and `--file`, typed by the operation's generated
 * schemas, as `--set` is on the resource commands.
 */
export class ApiCall {
  /** What the user named: an operation id, or a path with its path values. */
  readonly target: Target;

  /**
   * @param target - The resolved operation, with what its path already gave.
   */
  private constructor(target: Target) {
    this.target = target;
  }

  /**
   * The call for a resolved target.
   *
   * @param target - The operation the user named.
   * @returns The call.
   */
  static to(target: Target): ApiCall {
    return new ApiCall(target);
  }

  /**
   * The generated Zod schema for one part of an operation's request:
   * `QueryUsersBody`, `ListEventsQueryParams`. orval names them after the
   * `operationId` with its first letter raised.
   *
   * @param operation - The operation.
   * @param part - Which part of its request.
   * @returns The schema, or undefined when none was generated.
   */
  static schemaOf(operation: Operation, part: "Body" | "QueryParams"): ZodLike | undefined {
    const name = `${operation.id.charAt(0).toUpperCase()}${operation.id.slice(1)}${part}`;
    return Object.hasOwn(schemas, name)
      ? ((schemas as Record<string, unknown>)[name] as ZodLike)
      : undefined;
  }

  /**
   * The `--file` document: a file, or stdin with `-`. Reading a terminal to
   * its end would look like a hang, so `-` with nothing piped in is refused.
   *
   * @param source - The path, `-` for stdin, or undefined when none was given.
   * @param retry - The run again with `--file <path>`, which the refusal suggests.
   * @returns The document, or undefined when no source was given.
   * @throws {ZitadelError} E_VALIDATION when `-` is given with nothing piped in, or the document is no JSON object.
   */
  static async readInput(
    source: string | undefined,
    retry: Suggested,
  ): Promise<Readonly<Record<string, unknown>> | undefined> {
    if (source === undefined) {
      return undefined;
    }
    if (source === "-") {
      if (process.stdin.isTTY) {
        throw new ZitadelError(
          "E_VALIDATION",
          "--file - reads the body from a pipe, but nothing is piped in",
          {
            hint: "Pipe a body in and pass --file -, or pass --file <path>.",
            nextCommands: [retry],
          },
        );
      }
    }
    const name = source === "-" ? "stdin" : source;
    const contents = source === "-" ? await text(process.stdin) : await readFile(source, "utf8");
    try {
      return parseJsonObject(contents, name);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ZitadelError("E_VALIDATION", `${name} is not valid JSON`, {
          hint: "Pass one JSON object with --file.",
        });
      }
      throw error;
    }
  }

  /**
   * Fill the operation's path parameters: from the path itself when the target
   * was a path, else from the positionals in path order. A `project_id` still
   * missing is the CLI's own project, as the resource commands take it.
   *
   * @param positionals - The arguments after the operation.
   * @param projectId - The CLI's project, when it has one.
   * @returns The values read, and the names still without one.
   * @throws {ZitadelError} E_VALIDATION when there are more positionals than parameters, or a value is not a safe id.
   */
  pathValues(positionals: readonly string[], projectId: string | undefined): PathValues {
    const { target } = this;
    const names = target.operation.pathParameters;
    const fromPath = Object.keys(target.pathValues).length > 0;
    if (positionals.length > 0 && (fromPath || names.length === 0)) {
      throw new ZitadelError(
        "E_VALIDATION",
        names.length === 0
          ? `${target.operation.id} takes no path parameters, but got ${positionals.join(" ")}`
          : `The path already names ${names.join(", ")}, so ${positionals.join(" ")} is one argument too many`,
        {
          hint: "Give a path parameter either in the path or as an argument after an operation id.",
        },
      );
    }
    if (positionals.length > names.length) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${target.operation.id} takes ${names.length} ${new Intl.PluralRules("en").select(names.length) === "one" ? "path parameter" : "path parameters"} (${names.join(", ")}), but got ${positionals.length}`,
        { hint: `Give them in the path's order: ${target.operation.path}.` },
      );
    }
    const values: Record<string, string> = { ...target.pathValues };
    for (const [index, value] of positionals.entries()) {
      const name = names[index];
      if (name !== undefined) {
        values[name] = value;
      }
    }
    if (values.project_id === undefined && names.includes("project_id") && projectId) {
      values.project_id = projectId;
    }
    const checked: Record<string, string> = {};
    for (const [name, value] of Object.entries(values)) {
      checked[name] = read(SAFE_ID, value, name);
    }
    return {
      values: checked,
      missing: names.filter((name) => {
        return values[name] === undefined;
      }),
    };
  }

  /**
   * Build the request: the path template, the query, and the body.
   *
   * A field whose name the operation declares as a query parameter sets that
   * parameter; every other field is a dot path into the body, laid over
   * `--file`. A body the operation requires but nothing gave is `{}`, the
   * empty document.
   *
   * @param input - The fields, the `--file` document and the CLI's project.
   * @returns The request, its path parameters not yet filled in.
   * @throws {ZitadelError} E_VALIDATION for a field the operation cannot take.
   */
  request({ fields, input, projectId }: RequestInput): ApiRequest {
    const { operation } = this.target;
    const query = new Map<string, readonly string[]>();
    for (const [name, value] of this.target.query) {
      query.set(name, [...(query.get(name) ?? []), value]);
    }
    if (input !== undefined && operation.body === null) {
      throw new ZitadelError("E_VALIDATION", `${operation.id} takes no body, but --file gave one`, {
        hint: "Leave out --file.",
      });
    }

    const fragments: unknown[] = [];
    const given = new Set<string>();
    const bodySchema = ApiCall.schemaOf(operation, "Body");
    for (const raw of fields) {
      const head = ApiCall.headOf(raw);
      const parameter = operation.parameters.find((candidate) => {
        return candidate.name === head;
      });
      if (parameter?.in === "query") {
        if (!/^[^.]+:?=/.test(raw)) {
          throw new ZitadelError(
            "E_VALIDATION",
            `${FIELD} ${head} is a query parameter, which has no fields`,
            { hint: `Give it as ${FIELD} ${head}=value.` },
          );
        }
        const { list, values } = ApiCall.queryField(
          raw,
          head,
          ApiCall.schemaOf(operation, "QueryParams"),
        );
        // The first field for a name replaces what the path's query string
        // said; a list's further fields add to it.
        query.set(head, list && given.has(head) ? [...(query.get(head) ?? []), ...values] : values);
        given.add(head);
        continue;
      }
      if (parameter) {
        throw new ZitadelError(
          "E_VALIDATION",
          parameter.in === "path"
            ? `${head} is a path parameter of ${operation.id}; give it as an argument`
            : `${head} is a ${parameter.in} parameter, which the CLI does not send`,
          parameter.in === "path"
            ? { hint: "Give it after the operation, in the order the path declares them." }
            : {},
        );
      }
      if (operation.body === null) {
        const names = operation.parameters
          .filter((candidate) => {
            return candidate.in === "query";
          })
          .map((candidate) => {
            return candidate.name;
          });
        throw new ZitadelError(
          "E_VALIDATION",
          `${operation.id} takes no body, and ${head} is none of its query parameters`,
          {
            hint:
              names.length > 0
                ? `Its query parameters: ${names.join(", ")}.`
                : `${operation.id} takes no fields.`,
            details: { field: head, query_parameters: names },
          },
        );
      }
      const assignment = readAssignment(raw, bodySchema, ApiCall.bodyFields(bodySchema), FIELD);
      fragments.push(fragmentOf(assignment));
    }
    const body = fragments.reduce<unknown>(
      (merged, fragment) => {
        return mergeDocuments(merged ?? {}, fragment);
      },
      input ?? (operation.body === "required" ? {} : undefined),
    );

    const projectParameter = operation.parameters.find((candidate) => {
      return candidate.in === "query" && candidate.name === "project_id";
    });
    if (projectParameter?.required && !query.has("project_id") && projectId) {
      query.set("project_id", [projectId]);
    }

    return {
      operation,
      path: operation.path,
      query: [...query].flatMap(([name, values]) => {
        return values.map((value) => {
          return [name, value] as const;
        });
      }),
      ...(body === undefined ? {} : { body }),
    };
  }

  /**
   * The request with its path parameters filled in, each percent-encoded.
   *
   * @param request - The request {@link ApiCall.request} built.
   * @param pathValues - The values {@link ApiCall.pathValues} read.
   * @returns The request, ready to send.
   */
  fill(request: ApiRequest, pathValues: Readonly<Record<string, string>>): ApiRequest {
    return {
      ...request,
      path: request.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
        return encodeURIComponent(pathValues[name] ?? "");
      }),
    };
  }

  /**
   * The first segment of a field's name: `idp` for `idp.oidc.issuer=…`.
   *
   * @param raw - The field as given.
   * @returns Its first name segment.
   */
  private static headOf(raw: string): string {
    const at = raw.indexOf("=");
    const name = at === -1 ? raw : raw.slice(0, raw[at - 1] === ":" ? at - 1 : at);
    return name.split(".")[0] ?? "";
  }

  /**
   * A query parameter's value as the URL carries it: a list repeats the name.
   *
   * @param name - The parameter.
   * @param value - The value or list read for it.
   * @returns The values, as text.
   * @throws {ZitadelError} E_VALIDATION when a value is null or an object.
   */
  private static queryValues(name: string, value: unknown): readonly string[] {
    const values = Array.isArray(value) ? value : [value];
    if (
      values.some((item) => {
        return item === null || typeof item === "object";
      })
    ) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${FIELD} ${name} is a query parameter, which takes a value or a list of values`,
        {
          hint: `Give it as ${FIELD} ${name}=value, or a list as ${FIELD} '${name}:=["a","b"]'.`,
        },
      );
    }
    return values.map(String);
  }

  /**
   * One query field's values. A list parameter takes one value per field, as a
   * query string repeats its name (`-F category=auth -F category=session`), or
   * the whole list as JSON; any other takes its one value.
   *
   * @param raw - The field as given.
   * @param name - The parameter's name.
   * @param schema - The operation's generated query schema.
   * @returns Whether the parameter is a list, and the values this field gave.
   */
  private static queryField(
    raw: string,
    name: string,
    schema: ZodLike | undefined,
  ): { list: boolean; values: readonly string[] } {
    const node = nodeAt(schema, [name])?.node;
    const type = unwrap(node);
    if (type?.def?.type !== "array" || raw.startsWith(`${name}:=`)) {
      return {
        list: false,
        values: ApiCall.queryValues(name, readAssignment(raw, schema, [], FIELD).value),
      };
    }
    const text = raw.slice(name.length + 1);
    return {
      list: true,
      values: ApiCall.queryValues(name, typedValue(type.def.element, text, `${FIELD} ${name}`)),
    };
  }

  /**
   * The body's fields, for an error that names the ones a path could have
   * meant. Without their flags: those belong to the resource commands.
   *
   * @param schema - The operation's generated body schema.
   * @returns The fields, flagless.
   */
  private static bodyFields(schema: ZodLike | undefined) {
    return schema === undefined
      ? []
      : describeBody(schema as Schema).map(({ flag: _flag, ...field }) => {
          return field;
        });
  }
}
