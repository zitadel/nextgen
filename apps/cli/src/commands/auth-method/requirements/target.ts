import { type FlowFile, readSchemaFiles, type SchemaFile, selectSchema } from "../../../lib/idp";
import { requirement, unmet } from "../../../lib/oclif/requirements";
import { optionArgs } from "../../../lib/public-cli";
import { flowsForSchema } from "../../../lib/schema-flows";

/** What every `auth-method` command reads before changing anything. */
export type SchemaTarget = {
  readonly cwd: string;
  readonly cwdArgs: string[];
  readonly schema: SchemaFile;
  readonly flows: FlowFile[];
};

/**
 * The schema the run is about, chosen by `--schema` or as the Project's only
 * one, and the login flows that run against it. A schema that points at an
 * external URL holds no sign-in methods of its own, so it is refused.
 */
export const schemaTarget = requirement<SchemaTarget>({
  refusal: {
    message: "{file} points at an external schema",
    hint:
      "Its sign-in methods live in the schema at its url, which the server fetches. " +
      "Edit x-auth-methods there instead.",
    details: {
      file: "{file}",
      url: "{url}",
    },
  },
  resolve: async ({ flags, meta }) => {
    const { cwd } = meta;
    const schema = selectSchema(
      await readSchemaFiles(cwd),
      typeof flags.schema === "string" ? flags.schema : undefined,
    );
    if (schema.body.kind === "schema-url") {
      return unmet({
        file: schema.path,
        url: schema.body.url,
      });
    }
    return {
      cwd,
      cwdArgs: flags.cwd === undefined ? [] : optionArgs("--cwd", cwd),
      schema,
      flows: await flowsForSchema(cwd, schema),
    };
  },
});
