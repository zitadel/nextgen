import { renderBox } from "../box";
import { type ConnectionFile, readConnectionFiles } from "./connections";
import { schemaProviders } from "./documents";
import { mappingLines, unmappedAttributes, unmappedLines, usedByLines } from "./mappings";
import { readSchemaFiles, type SchemaFile } from "./schemas";

/**
 * The display name a connection should be announced under: its own
 * `display_name` when it has one, else the file's slug. The box header reads
 * "SIGN IN WITH <name>", so a provider the user recognises, not a file path.
 */
function connectionName(file: ConnectionFile): string {
  const given = file.body.display_name;
  if (typeof given === "string" && given !== "") {
    return given;
  }
  return (file.path.split("/").pop() ?? file.path).replace(/\.json$/, "");
}

/**
/** The schemas that sign in through a connection, found by its slug. */
function schemasUsing(file: ConnectionFile, schemas: readonly SchemaFile[]): SchemaFile[] {
  const slug = String(file.body.slug ?? "").trim();
  if (slug === "") {
    return [];
  }
  return schemas.filter((schema) => schemaProviders(schema.body).includes(slug));
}

/**
 * One rounded box per connection under `.zitadel/idps/`, each headed
 * "SIGN IN WITH <name>" and listing what the connection maps: the claim
 * mapping, what makes it verified, and the scopes it requests. The diff a
 * deploy shows says every field that changed; this says what a person has to
 * review before a release — read from the files on disk, which hold variable
 * references and never a secret.
 *
 * Each box also names the attributes the signing-in schemas define that no
 * claim fills, and which schemas sign in through the connection, so a person
 * sees what a mapping leaves empty and who a change to it affects.
 *
 * Returns one string per connection, in lexical file order. Empty when the
 * project has no connections.
 */
export async function renderConnectionSummaries(cwd: string): Promise<string[]> {
  const [files, schemas] = await Promise.all([readConnectionFiles(cwd), readSchemaFiles(cwd)]);
  return files.map((file) => {
    const usedBy = schemasUsing(file, schemas);
    const attributes = usedBy.flatMap((schema) => schema.properties);
    return renderBox({
      title: `SIGN IN WITH ${connectionName(file).toUpperCase()}`,
      message: [
        ...mappingLines(file.body, file.path),
        ...unmappedLines(unmappedAttributes(file.body, attributes), file.path),
        ...usedByLines(usedBy.map((schema) => schema.name)),
      ].join("\n"),
    });
  });
}
