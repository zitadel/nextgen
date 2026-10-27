import type { BoxAction } from "../box";
import type { Summary } from "../ui";

/** The lines that say what a command did, as opposed to the detail under them. */
const RESULT =
  /^(Deployed|Validated|Set |Removed|Added|Rolled back|Revoked|Would |Skipped:|Zitadel \w+ (passed|failed)|Nothing to|\d+ [a-z-]+( [a-z-]+)*\.?$|No .+\.$)/;

/** The widest a closing line may be, server included, so it never wraps. */
const HEADLINE_WIDTH = 76;

/** The label that introduces bare commands which have no sentence of their own. */
const RUN_NEXT = "Run next:";

/**
 * Turns the label-like headlines commands print into the sentence the chain
 * closes on. `1 variable` is a count, `GREETING` the name of what was read.
 */
function sentence(id: string | undefined, title: string): string {
  const count = /^(\d+) (.+)$/.exec(title);
  if (count !== null) {
    return `Found ${count[1]} ${count[2]}`;
  }
  const environment = /^Environment\s+(\S+)(.*)$/.exec(title);
  if (environment !== null) {
    return `Using the ${environment[1]} environment${environment[2]}`;
  }
  if (title === "Zitadel status") {
    return "Checked the status of the project";
  }
  if (/^Zitadel doctor passed$/.test(title)) {
    return "All checks passed";
  }
  if (/^Zitadel doctor failed$/.test(title)) {
    return "Some checks failed";
  }
  const cancelled = /^Skipped: \w+-cancelled/.exec(title);
  if (cancelled !== null) {
    return "Cancelled, nothing was changed";
  }
  if (id === "variable:get" && /^[A-Za-z0-9_.-]+$/.test(title)) {
    return `Read ${title}`;
  }
  return title;
}

/** A command a step tells the reader to run, wherever the command's text put it. */
const INLINE = /^(.*?): ((?:zitadel|npx|npm|pnpm|yarn|bun|rm|git) .+)$/;

/**
 * The steps a box lists, from the lines of a command's own text. A step is a
 * sentence and, under it, the commands it asks for: `$ cmd` lines, lines
 * indented under a sentence ending in a colon, or a command the sentence names
 * after a colon. Every command's steps are built this way, so they all read the
 * same however that command happened to write them.
 */
export function nextSteps(lines: readonly string[]): BoxAction[] {
  const steps: BoxAction[] = [];
  let lead: string[] = [];
  let commands: string[] = [];
  const flush = () => {
    const text = lead.join(" ").trim();
    if (commands.length === 0) {
      if (text !== "") {
        steps.push({ text });
      }
    } else if (text.endsWith(":")) {
      // The sentence introduces the commands, so they belong under it.
      steps.push({ text, command: commands.join("\n") });
    } else {
      // A sentence that stands on its own, then the commands under the one label
      // every command uses for commands nothing else introduces.
      if (text !== "") {
        steps.push({ text });
      }
      steps.push({ text: RUN_NEXT, command: commands.join("\n") });
    }
    lead = [];
    commands = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    const indent = raw.length - raw.trimStart().length;
    const inline = INLINE.exec(line);
    if (line === "") {
      flush();
    } else if (line.startsWith("$ ")) {
      commands.push(line.slice(2));
    } else if (lead.at(-1)?.endsWith(":") === true && indent >= 2) {
      commands.push(line);
    } else if (inline !== null && commands.length === 0 && lead.length === 0) {
      lead.push(`${inline[1]}:`);
      commands.push(inline[2] ?? "");
      flush();
    } else {
      if (commands.length > 0) {
        flush();
      }
      lead.push(line);
    }
  }
  flush();
  return steps;
}

/**
 * Splits what a command printed into the single line that closes the chain and
 * what goes under it. The closing line is one sentence: the line that says what
 * happened (`Set X on the project`), with the server it ran against in
 * parentheses. A longer one is cut at its first sentence, and the rest goes under it.
 */
export function summaryOfText(
  text: string,
  failed = false,
  boxed = false,
  id?: string,
  given: readonly string[] = [],
): Summary {
  const lines = text.split("\n").map((line) => line.replace(/\s+$/, ""));
  while (lines[0]?.trim() === "") {
    lines.shift();
  }
  while (lines.at(-1)?.trim() === "") {
    lines.pop();
  }
  const columns = (line: string | undefined) => line !== undefined && /\S {2,}\S/.test(line);
  const at = failed
    ? -1
    : lines.findIndex((line) => RESULT.test(line) && !line.startsWith("No diff"));
  // A table with nothing that says what happened: the closing line is plain, the table stays.
  const noHeadline = at < 0 && !failed && columns(lines[0]);
  let title = "Done";
  let trailing: string[] = [];
  if (!noHeadline) {
    // What a listing prints after its count — `Resolved now: …` and the like —
    // belongs in the footer beside the count, not as another line of the body.
    if (!boxed && at >= 0 && lines.slice(at + 1).every((line) => !columns(line))) {
      trailing = lines
        .splice(at + 1)
        .map((line) => line.trim())
        .filter((line) => line !== "");
    }
    [title = "Done"] = lines.splice(at < 0 ? 0 : at, 1);
  }
  // `(server: host)` says where the command ran. It closes the headline, not a line of its own.
  const serverAt = lines.findIndex((line) => /^\(server: .+\)$/.test(line.trim()));
  const ran =
    serverAt < 0
      ? undefined
      : /^\(server: (.+)\)$/.exec(lines.splice(serverAt, 1)[0]?.trim() ?? "")?.[1];
  const extras = [...given, ...trailing];
  if (title === "Zitadel command completed.") {
    title = "Done";
  }
  title = sentence(id, title.replace(/\.$/, ""));

  // A title that is still too long to read as one line is replaced by a plain
  // one and said in full underneath; a command should not produce one.
  const overflow: string[] = [];
  if (!failed && title.length > HEADLINE_WIDTH) {
    overflow.push(title);
    title = "Done";
  }
  const headline = title;

  const nextAt = lines.findIndex((line) => line.trim() === "Next:");
  if (boxed || nextAt >= 0) {
    // Everything after `Next:` is what to do next; a command that asked for a box
    // without saying `Next:` has a text that is all steps.
    const before = nextAt < 0 ? [] : lines.slice(0, nextAt);
    return {
      title: headline,
      sections: [],
      lines: [...overflow, ...(nextAt < 0 ? [] : before)],
      next: nextSteps(nextAt < 0 ? lines : lines.slice(nextAt + 1)),
      boxed: true,
      ...(extras.length === 0 ? {} : { extras }),
      ...(failed ? { failed } : {}),
      ...(ran === undefined ? {} : { ran }),
    };
  }
  while (lines[0]?.trim() === "") {
    lines.shift();
  }
  return {
    title: headline,
    sections: [],
    lines: [...overflow, ...(overflow.length > 0 && lines.length > 0 ? [""] : []), ...lines],
    ...(extras.length === 0 ? {} : { extras }),
    ...(failed ? { failed } : {}),
    ...(ran === undefined ? {} : { ran }),
  };
}
