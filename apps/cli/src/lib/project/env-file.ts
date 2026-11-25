import { parseEnv } from "node:util";

import { readIfExists } from "@/lib/fs";

import { ProjectInvalidError } from "./errors";
import { SecretFile } from "./secret-file";

/**
 * A managed `.env.<name>.local` file, and the single writer for it.
 *
 * These files may hold a credential (`ZITADEL_PROJECT_SECRET`,
 * `ZITADEL_PREVIEW_TOKEN`), so the mode, the chmod-failure policy and the
 * line-break guard are decided here once rather than re-decided, or forgotten,
 * at each write site. Nothing else in the CLI should write one of these files
 * with `node:fs`.
 */
export class EnvFile {
  /** Where it is. */
  readonly path: string;

  /**
   * @param path - The file's path.
   */
  constructor(path: string) {
    this.path = path;
  }

  /**
   * The file an environment's project id and secrets live in:
   * `.env.<name>.local`, which `env add` writes and a prompt's answer is saved
   * to.
   *
   * @param name - The environment.
   * @returns The file's name, in the project's root.
   */
  static nameFor(name: string): string {
    return `.env.${name}.local`;
  }

  /**
   * What `eject` renames an env file to, keeping the secrets it holds beside
   * the app rather than deleting them.
   *
   * @param path - The env file.
   * @param stamp - When it was ejected, as a name can hold it.
   * @returns The backup's path.
   */
  static backupOf(path: string, stamp: string): string {
    return `${path}.ejected-${stamp}`;
  }

  /**
   * One `key=value` line. One per line is the whole file format, so a line
   * break in a value would inject a spurious line (or split a secret) that the
   * next run reads back as different keys. A break is never a legitimate
   * credential, URL or id, so it is refused rather than written to a file that
   * cannot be read back faithfully. Every other value is quoted as much as it
   * needs to read back exactly.
   *
   * @param key - The variable.
   * @param value - Its value.
   * @returns The line, without its line break.
   * @throws {@link ProjectInvalidError} When the value has a line break, or no
   *   quoting reads it back unchanged.
   */
  static line(key: string, value: string): string {
    if (/[\n\r]/.test(value)) {
      throw new ProjectInvalidError(`Cannot persist ${key}: its value contains a line break.`);
    }
    // Written as the first form the reader gives back unchanged: bare, then
    // single- then double-quoted. A bare `#` starts a comment and a bare quote
    // is stripped, so a secret holding one would otherwise read back truncated.
    // A quote the value opens and never closes would run on into the next
    // line, so each form is read with a line after it, which must come back
    // untouched.
    const forms = [`${key}=${value}`, `${key}='${value}'`, `${key}="${value}"`];
    const faithful = forms.find((line) => {
      // Followed by lines quoted every way a later value might be, any of which
      // would close a quote this line left open.
      const read = parseEnv(`${line}\nNEXT_A='a'\nNEXT_B="b"\nNEXT_C=\`c\`\n`);
      return (
        read[key] === value && read.NEXT_A === "a" && read.NEXT_B === "b" && read.NEXT_C === "c"
      );
    });
    if (faithful === undefined) {
      throw new ProjectInvalidError(
        `Cannot persist ${key}: no .env quoting reads its value back unchanged.`,
      );
    }
    return faithful;
  }

  /**
   * Writes the file from scratch, creating or overwriting it, held at `0600`.
   * Every value is checked before anything is written, so a bad value fails
   * the whole write rather than corrupting the file.
   *
   * @param values - Each variable and its value.
   * @throws {@link ProjectInvalidError} When a value has a line break, or no
   *   quoting reads it back unchanged.
   */
  async write(values: Record<string, string>): Promise<void> {
    const body = `${Object.entries(values)
      .map(([key, value]) => {
        return EnvFile.line(key, value);
      })
      .join("\n")}\n`;
    await new SecretFile(this.path).write(body);
  }

  /**
   * Appends one `key=value`, creating the file if it is absent. A file without
   * a trailing newline is not concatenated onto its last line.
   *
   * @param key - The variable.
   * @param value - Its value.
   * @throws {@link ProjectInvalidError} When the value cannot be persisted.
   */
  async append(key: string, value: string): Promise<void> {
    const line = EnvFile.line(key, value);
    const existing = (await readIfExists(this.path)) ?? "";
    const next = `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${line}\n`;
    await new SecretFile(this.path).write(next);
  }
}
