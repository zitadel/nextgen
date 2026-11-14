import { escapeControlCharacters, escapeJsonControlCharacters } from "@/lib/terminal-text";

/**
 * What a command printed, ready to print.
 *
 * @remarks
 * A rendering is made by one of the four factories below, each of which spells
 * out what it is given in the spelling that shape takes: {@link prose} the way
 * a person reads an escape, {@link json} the way JSON spells one, and
 * {@link rows} and {@link painted} not at all, because their fragments were
 * spelled out where each was read. So nothing downstream has to work out which
 * treatment a string wanted. A summary is drawn as it is written, so a command
 * that puts text from a server in one spells it out itself.
 *
 * `kind` says only who the output is for: `piped` output is what a script
 * reads, so it keeps stdout to itself and the next steps go beside it on
 * stderr.
 */
export type Rendering = Readonly<{
  kind: "prose" | "piped" | "painted";
  text: string;
}>;

/**
 * A command's own words for a person, with what the server answered in them.
 * Every character that could drive a terminal is spelled out the way a person
 * reads it (`\x1b`), and the line breaks and tabs that lay the words out are
 * kept.
 *
 * @param text - What the command says.
 * @returns The rendering.
 */
export function prose(text: string): Rendering {
  return {
    kind: "prose",
    text: escapeControlCharacters(text),
  };
}

/**
 * A JSON body for a script to parse. Spelled out the way JSON spells a control
 * character, so what the reader parses back is the value the server sent —
 * `JSON.stringify` leaves the C1 characters, DEL and the bidi controls as they
 * came, and those drive a terminal as readily as `\x1b` does.
 *
 * @param value - What the command answers with.
 * @returns The rendering.
 */
export function json(value: unknown): Rendering {
  return {
    kind: "piped",
    text: escapeJsonControlCharacters(JSON.stringify(value, null, 2)),
  };
}

/**
 * The tab-separated records a pipe gets. Printed as it is: the tabs and line
 * breaks between the fields are the format, and every field was spelled out
 * where it was read.
 *
 * @param text - The records, already composed.
 * @returns The rendering.
 */
export function rows(text: string): Rendering {
  return {
    kind: "piped",
    text,
  };
}

/**
 * A rendering the CLI painted — a table it coloured — printed as it came,
 * because spelling it out would print the colour instead of applying it.
 *
 * Only for output composed of fragments already spelled out where they were
 * read: a table's cells, a list's count, its footer and its cursor. Anything
 * else is {@link prose}, which is safe without being asked.
 *
 * @param text - The rendering, already composed.
 * @returns The rendering.
 */
export function painted(text: string): Rendering {
  return {
    kind: "painted",
    text,
  };
}
