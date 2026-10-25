import { renderBox } from "../box";
import { type ConnectionFile, readConnectionFiles } from "./connections";
import { mappingLines } from "./mappings";

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
 * One rounded box per connection under `.zitadel/idps/`, each headed
 * "SIGN IN WITH <name>" and listing what the connection maps: the claim
 * mapping, what makes it verified, and the scopes it requests. The diff a
 * deploy shows says every field that changed; this says what a person has to
 * review before a release — read from the files on disk, which hold variable
 * references and never a secret.
 *
 * Returns one string per connection, in lexical file order. Empty when the
 * project has no connections.
 */
export async function renderConnectionSummaries(cwd: string): Promise<string[]> {
  const files = await readConnectionFiles(cwd);
  return files.map((file) =>
    renderBox({
      title: `SIGN IN WITH ${connectionName(file).toUpperCase()}`,
      message: mappingLines(file.body, file.path).join("\n"),
    }),
  );
}
