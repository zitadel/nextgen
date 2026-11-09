import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { JsonObject, JsonValue } from "@/lib/zitadel";
import { type ConfigDocuments, configFiles } from "@tests/helpers/config";

/**
 * The schema the `auth-method` commands change when the Project has only one.
 */
export const DEFAULT_SCHEMA = "default-human-user";

/**
 * Where the default schema lives in a Project.
 */
export const SCHEMA_FILE = `.zitadel/schemas/${DEFAULT_SCHEMA}.json`;

/**
 * Where the default schema's login flow lives in a Project.
 */
export const LOGIN_FLOW_FILE = `.zitadel/flows/${DEFAULT_SCHEMA}-login.json`;

/**
 * The action that submits a step's fields.
 */
export const SUBMIT_ACTION = { name: "submit", kind: "submit", primary: true } as const;

/**
 * The entry step of a password flow: it collects the email, then moves to the
 * password step.
 */
export const IDENTIFIER_STEP = {
  name: "identifier",
  fields: ["email"],
  actions: [SUBMIT_ACTION],
  transitions: { submit: { target: "password" } },
} as const;

/**
 * The step that collects the password, then finishes.
 */
export const PASSWORD_STEP = {
  name: "password",
  fields: ["x-auth-methods#password"],
  actions: [SUBMIT_ACTION],
  transitions: { submit: { target: "done" } },
} as const;

/**
 * The step that ends a flow.
 */
export const DONE_STEP = { name: "done", complete: "show" } as const;

/**
 * The `$id` a schema is named by, which its login flow names in `user_schema`.
 *
 * @param name - The schema's file name, without `.json`.
 * @returns The `$id`.
 */
export function schemaIdOf(name: string): string {
  return `https://schemas.test.invalid/${name}.json`;
}

/**
 * A user schema that signs in by email, with these `x-auth-methods`, whose
 * `objectType` is its file name.
 *
 * @param methods - The `x-auth-methods` block, taken as written.
 * @param name - The schema's file name, without `.json`.
 * @returns The schema document.
 */
export function aSchema(methods: JsonValue, name: string = DEFAULT_SCHEMA): JsonObject {
  return {
    $id: schemaIdOf(name),
    objectType: name,
    kind: "user-schema",
    metaSchema: "https://example.com/meta/user-schema.json",
    type: "object",
    "x-identifier": "email",
    required: ["email"],
    properties: { email: { type: "string", format: "email" } },
    "x-auth-methods": methods,
  };
}

/**
 * The shipped password login flow, cut to what the validator needs: the
 * identifier step, the password step, and done.
 *
 * @param schema - The name of the schema the flow signs users of in.
 * @returns The flow document.
 */
export function aPasswordFlow(schema: string = DEFAULT_SCHEMA) {
  return {
    name: `${schema}-login`,
    status: "active",
    user_schema: schemaIdOf(schema),
    purposes: { login: "identifier" },
    steps: [IDENTIFIER_STEP, PASSWORD_STEP, DONE_STEP],
  };
}

/**
 * The password login flow with these SSO providers offered on its entry step.
 *
 * @param providers - The providers the entry step offers.
 * @param schema - The name of the schema the flow signs users of in.
 * @returns The flow document.
 */
export function aFlowOffering(providers: readonly string[], schema: string = DEFAULT_SCHEMA) {
  return {
    ...aPasswordFlow(schema),
    steps: [
      {
        ...IDENTIFIER_STEP,
        sso_providers: providers,
        transitions: { ...IDENTIFIER_STEP.transitions, sso_authenticated: { target: "done" } },
      },
      PASSWORD_STEP,
      DONE_STEP,
    ],
  };
}

/**
 * The documents of a Project with the default schema and, when given, its
 * login flow.
 *
 * @param methods - The schema's `x-auth-methods` block.
 * @param flow - The schema's login flow, if it has one.
 * @returns The documents.
 */
export function aProject(methods: JsonValue, flow?: JsonObject): ConfigDocuments {
  if (flow === undefined) {
    return { schemas: { [`${DEFAULT_SCHEMA}.json`]: aSchema(methods) } };
  }
  return {
    schemas: { [`${DEFAULT_SCHEMA}.json`]: aSchema(methods) },
    flows: { [`${DEFAULT_SCHEMA}-login.json`]: flow },
  };
}

/**
 * Writes a Project into `cwd`: its `zitadel.json`, the schemas and flows
 * directories, each document at `.zitadel/<directory>/<name>`, and other files
 * as written.
 *
 * @param cwd - The directory to write the Project into; made if it is missing.
 * @param documents - The documents of each kind, by file name.
 * @param files - Other files, by project-relative path, such as one that is not valid JSON.
 * @returns Once every file is written.
 */
export async function writeProject(
  cwd: string,
  documents: ConfigDocuments,
  files: Readonly<Record<string, string>> = {},
): Promise<void> {
  const documentFiles = Object.values(configFiles(documents))
    .flat()
    .map((file) => {
      return [file.path, `${JSON.stringify(file.body)}\n`] as const;
    });
  const entries: ReadonlyArray<readonly [string, string]> = [
    ["zitadel.json", `${JSON.stringify({ version: "0.0.1" })}\n`],
    ...documentFiles,
    ...Object.entries(files),
  ];
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
  for (const [path, body] of entries) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), body);
  }
}

/**
 * The arguments of a scripted `auth-method` run against the Project in `cwd`
 * that prints its `--json` envelope.
 *
 * @param cwd - The Project.
 * @param words - The subcommand and its flags, such as `passkey disable --dry-run`.
 * @returns The arguments.
 */
export function authMethodJson(cwd: string, ...words: string[]): string[] {
  return ["auth-method", ...words, "--cwd", cwd, "--json", "--non-interactive"];
}

/**
 * The arguments of a scripted `auth-method` run against the Project in `cwd`
 * that prints its text output.
 *
 * @param cwd - The Project.
 * @param words - The subcommand and its flags, such as `passkey disable --dry-run`.
 * @returns The arguments.
 */
export function authMethodText(cwd: string, ...words: string[]): string[] {
  return ["auth-method", ...words, "--cwd", cwd, "--non-interactive"];
}
