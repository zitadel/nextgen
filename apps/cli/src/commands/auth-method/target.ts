import { type FlowFile, readSchemaFiles, type SchemaFile, selectSchema } from "../../lib/idp";
import { type Refusal, refusalError } from "../../lib/oclif/refusal";
import { optionArgs } from "../../lib/public-cli";
import { flowsForSchema } from "../../lib/schema-flows";

/** What every `auth-method` command reads before changing anything. */
export type SchemaTarget = {
  readonly cwd: string;
  readonly cwdArgs: string[];
  readonly schema: SchemaFile;
  readonly flows: FlowFile[];
};

/** What a schema pointing at an external URL is refused for. */
const EXTERNAL_SCHEMA_REFUSAL: Refusal = {
  message: "{file} points at an external schema",
  hint:
    "Its sign-in methods live in the schema at its url, which the server fetches. " +
    "Edit x-auth-methods there instead.",
  details: {
    file: "{file}",
    url: "{url}",
  },
};

/**
 * The schema the run is about, chosen by `--schema` or as the Project's only
 * one, and the login flows that run against it. A schema that points at an
 * external URL holds no sign-in methods of its own, so it is refused.
 */
export async function readSchemaTarget(input: {
  cwd: string;
  schema: string | undefined;
  cwdGiven: boolean;
}): Promise<SchemaTarget> {
  const schema = selectSchema(await readSchemaFiles(input.cwd), input.schema);
  if (schema.body.kind === "schema-url") {
    throw refusalError(EXTERNAL_SCHEMA_REFUSAL, {
      file: schema.path,
      url: schema.body.url,
    });
  }
  return {
    cwd: input.cwd,
    cwdArgs: input.cwdGiven ? optionArgs("--cwd", input.cwd) : [],
    schema,
    flows: await flowsForSchema(input.cwd, schema),
  };
}
