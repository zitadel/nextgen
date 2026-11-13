import { visit } from "jsonc-parser";

/**
 * The end of the message V8 gives a syntax error it can place: the position as
 * a number, then as a line and a column.
 *
 * @remarks
 * A message that quotes the source instead of placing the error ends in
 * `is not valid JSON`, so it never matches.
 */
const V8_PLACE = / in JSON at position \d+ \(line (?<line>\d+) column (?<column>\d+)\)$/;

/**
 * How `jsonc-parser` is held to the same rules as `JSON.parse`.
 */
const STRICT_JSON = { allowTrailingComma: false, disallowComments: true } as const;

/**
 * A configuration file a store found but could not take as a JSON object.
 *
 * @remarks
 * It has no body, so nothing can mistake it for an empty one. A store hands it
 * on instead of refusing the read, so the one file is reported as a broken
 * file and the rest of the configuration still loads. The reasons a file is
 * refused are made here and nowhere else, by the constructor that names them,
 * so every store words them the same way.
 */
export class UnparsedFile {
  /**
   * The file's project-relative path.
   */
  readonly path: string;

  /**
   * Why the file could not be taken as a JSON object, such as
   * `invalid JSON at line 2, column 5` or `not a JSON object`.
   */
  readonly unparsed: string;

  /**
   * Hold a reason; the named constructors below are the ways to make one.
   *
   * @param path - The file's project-relative path.
   * @param unparsed - Why the file could not be taken as a JSON object.
   */
  private constructor(path: string, unparsed: string) {
    this.path = path;
    this.unparsed = unparsed;
  }

  /**
   * A file whose text is not valid JSON.
   *
   * @remarks
   * Only the place of the error, as a line and a column, is kept, never a
   * piece of the text: the reason is shown to a person, and a connection file
   * is where a pasted secret would be. V8 gives the place of most errors,
   * exactly, and quotes the source for the rest, so for those the place is
   * where `jsonc-parser` finds the error, which for a string, a number or a
   * literal is where that token starts. Lines and columns count from 1, a line
   * ends at `\r\n`, `\r` or `\n`, and a column counts UTF-16 code units, as
   * editors do.
   *
   * @param path - The file's project-relative path.
   * @param text - The text that `JSON.parse` refused.
   * @returns The file, with the place of the error when one can be found.
   */
  static invalidJson(path: string, text: string): UnparsedFile {
    const place = UnparsedFile.placeV8Reports(text) ?? UnparsedFile.placeParserFinds(text);
    return new UnparsedFile(
      path,
      place === undefined ? "invalid JSON" : `invalid JSON at ${place}`,
    );
  }

  /**
   * A file that is valid JSON but not an object.
   *
   * @param path - The file's project-relative path.
   * @returns The file.
   */
  static notAnObject(path: string): UnparsedFile {
    return new UnparsedFile(path, "not a JSON object");
  }

  /**
   * A directory named like a file.
   *
   * @param path - The directory's project-relative path.
   * @returns The file.
   */
  static directory(path: string): UnparsedFile {
    return new UnparsedFile(path, "is a directory");
  }

  /**
   * The place V8 gives for the error in a text.
   *
   * @param text - The text.
   * @returns The place, such as `line 5, column 24`; `undefined` when V8 gives
   *   none, or the text is valid.
   */
  private static placeV8Reports(text: string): string | undefined {
    try {
      JSON.parse(text);
    } catch (error) {
      const found = V8_PLACE.exec(error instanceof Error ? error.message : "")?.groups;
      if (found?.line !== undefined && found.column !== undefined) {
        return `line ${found.line}, column ${found.column}`;
      }
    }
    return undefined;
  }

  /**
   * The place `jsonc-parser` finds the first error in a text.
   *
   * @remarks
   * The parser recurses once per level of nesting, so a text nested far beyond
   * anything written by hand overflows the stack. That is no reason to lose the
   * file, which is still reported as broken, only without a place.
   *
   * @param text - The text.
   * @returns The place, such as `line 5, column 22`; `undefined` when it finds
   *   no error or cannot follow the text.
   */
  private static placeParserFinds(text: string): string | undefined {
    const places: string[] = [];
    try {
      visit(
        text,
        {
          onError: (_error, _offset, _length, line, character) => {
            places.push(`line ${line + 1}, column ${character + 1}`);
          },
        },
        STRICT_JSON,
      );
    } catch {
      return undefined;
    }
    return places.at(0);
  }
}
