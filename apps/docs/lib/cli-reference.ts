import { getTableOfContents } from "fumadocs-core/content/toc";
import { remarkGfm, type StructuredData, structure } from "fumadocs-core/mdx-plugins";
import type { LoaderPlugin, MetaData, Source } from "fumadocs-core/source";
import type { TOCItemType } from "fumadocs-core/toc";

// The CLI's commands, from the reference its test keeps current
// (apps/cli/command-reference.json), bundled by scripts/bundle-cli.mjs and
// imported as a module, so it ships inside the build.
import reference from "../.generated/cli.mjs";
import { cli } from "./cli-sample.ts";
import { shortDescription } from "./description.ts";

// The CLI reference: a page per command, under /docs/reference/cli, in the
// groups and the order `zitadel --help` lists them, and an index with the
// flags every command takes. A page is Markdown, the same text for the page
// (components/cli-page.tsx), its Markdown twin and search.

/** A flag as apps/cli/src/lib/oclif/reference.ts describes it. */
export type CliFlag = {
  name: string;
  char?: string;
  description?: string;
  type: "boolean" | "option";
  allowNo?: true;
  required?: true;
  multiple?: true;
  options?: string[];
  default?: boolean | number | string;
  min?: number;
  max?: number;
  exclusive?: string[];
  helpGroup?: string;
};

export type CliArg = { name: string; description?: string; required?: true; options?: string[] };

export type CliCommand = {
  /** The command after the bin: `auth-method sso enable`. */
  id: string;
  group: string;
  description: string;
  aliases?: string[];
  state?: string;
  args: CliArg[];
  flags: CliFlag[];
  /** Each example's command line, after the bin. */
  examples: { command: string; description?: string }[];
};

export type CliReference = {
  bin: string;
  groups: string[];
  globalFlags: CliFlag[];
  commands: CliCommand[];
};

const baseDir = "reference/cli";
const indexUrl = "/docs/reference/cli";

/** A command's page: `users list` is /docs/reference/cli/users/list. */
export function cliCommandUrl(command: string) {
  return `${indexUrl}/${command.split(" ").join("/")}`;
}

// ---- Markdown ---------------------------------------------------------------

// The help is plain text with code in backticks. Outside a code span, a `*`
// and a `<` that would open an HTML tag stay what they are.
function text(value: string) {
  return value
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\*|<(?=[A-Za-z/!?])/g, "\\$&")))
    .join("");
}

// A table cell is one line, and a `|` in it, even in a code span, ends it.
function cell(value: string) {
  return text(value.replace(/\s+/g, " ").trim()).replaceAll("|", "\\|");
}

function table(head: [string, string], rows: [string, string][]) {
  return [
    `| ${head[0]} | ${head[1]} |`,
    "| --- | --- |",
    ...rows.map(([left, right]) => `| ${left} | ${cell(right)} |`),
  ].join("\n");
}

const code = (value: string) => `\`${value}\``;
const list = (values: string[]) => values.map(code).join(", ");

function flagLabel(flag: CliFlag) {
  const name = flag.allowNo ? `--[no-]${flag.name}` : `--${flag.name}`;
  const label = flag.type === "option" ? `${name} <value>` : name;
  return code(flag.char ? `-${flag.char}, ${label}` : label);
}

function flagDescription(flag: CliFlag) {
  const range =
    flag.min !== undefined && flag.max !== undefined
      ? `From ${flag.min} to ${flag.max}.`
      : flag.min !== undefined
        ? `At least ${flag.min}.`
        : flag.max !== undefined
          ? `At most ${flag.max}.`
          : undefined;
  return [
    flag.description,
    flag.required && "Required.",
    flag.options && `One of ${list(flag.options)}.`,
    range,
    flag.default === true
      ? "On by default."
      : flag.default !== undefined && `Default: ${code(String(flag.default))}.`,
    flag.multiple && "Can be given more than once.",
    flag.exclusive && `Not with ${list(flag.exclusive.map((name) => `--${name}`))}.`,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

function flagTable(flags: CliFlag[]) {
  return table(
    ["Flag", "Description"],
    flags.map((flag) => [flagLabel(flag), flagDescription(flag)]),
  );
}

// The help's sections are capitalised (`REQUIRED FIELD`); a heading is in
// sentence case, except for an abbreviation.
const abbreviations = new Set(["API", "ID", "JSON", "OIDC", "SAML", "SSO", "URL"]);
function sectionName(group: string) {
  const words = group
    .split(/\s+/)
    .map((word) => (abbreviations.has(word) ? word : word.toLowerCase()));
  const sentence = words.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function usage(command: CliCommand) {
  const args = command.args.map(({ name, required }) => (required ? `<${name}>` : `[<${name}>]`));
  return [cli, command.id, ...args, "[flags]"].join(" ");
}

/** A command's page, as Markdown. */
function commandMarkdown(command: CliCommand) {
  const sections = [text(command.description)];
  if (command.state) sections.push(`This command is ${command.state}.`);
  if (command.aliases) {
    sections.push(`Also runs as ${list(command.aliases.map((alias) => `${cli} ${alias}`))}.`);
  }
  sections.push("## Usage", `\`\`\`sh\n${usage(command)}\n\`\`\``);

  if (command.args.length > 0) {
    const rows = command.args.map((arg): [string, string] => [
      code(`<${arg.name}>`),
      [arg.description, arg.required && "Required.", arg.options && `One of ${list(arg.options)}.`]
        .filter((part): part is string => typeof part === "string")
        .join(" "),
    ]);
    sections.push("## Arguments", table(["Argument", "Description"], rows));
  }

  // The flags the help lists first, then each of its sections, in order.
  sections.push("## Flags");
  const ungrouped = command.flags.filter((flag) => flag.helpGroup === undefined);
  if (ungrouped.length > 0) sections.push(flagTable(ungrouped));
  const groups = [...new Set(command.flags.flatMap((flag) => flag.helpGroup ?? []))];
  for (const group of groups) {
    const flags = command.flags.filter((flag) => flag.helpGroup === group);
    sections.push(`### ${sectionName(group)} flags`, flagTable(flags));
  }
  const globalFlags = `[global flags](${indexUrl}#global-flags)`;
  sections.push(
    command.flags.length > 0
      ? `It also takes the ${globalFlags}.`
      : `It takes only the ${globalFlags}.`,
  );

  if (command.examples.length > 0) {
    const lines = command.examples.flatMap(({ command: line, description }) => [
      ...(description ? [`# ${description}`] : []),
      `${cli} ${line}`,
    ]);
    sections.push("## Examples", `\`\`\`sh\n${lines.join("\n")}\n\`\`\``);
  }
  return sections.join("\n\n");
}

const indexDescription = "Every zitadel command, with its flags and examples.";

/** The reference's own page: how to run a command, the global flags, the commands. */
function indexMarkdown(cliReference: CliReference) {
  const groups = cliReference.groups.flatMap((group) => {
    const rows = cliReference.commands
      .filter((command) => command.group === group)
      // A description's first paragraph says what the command does.
      .map((command): [string, string] => [
        `[${code(command.id)}](${cliCommandUrl(command.id)})`,
        command.description.split(/\n\s*\n/, 1)[0] ?? "",
      ]);
    return rows.length > 0 ? [`## ${group}`, table(["Command", "Description"], rows)] : [];
  });

  return [
    `Every command of the \`${cliReference.bin}\` CLI, with its flags and examples, generated from the commands the CLI defines. Run a command with \`${cli} <command>\`; \`--help\` after it prints the same for the version you run.`,
    "In a script or as a coding agent, pass `--non-interactive --json`: every command then prints one JSON envelope, which [Agent setup](/docs/get-started/agents) describes.",
    "## Global flags",
    "Every command takes these.",
    flagTable(cliReference.globalFlags),
    ...groups,
    `\`${cli} --help\` also lists oclif's own commands, such as \`help\` and \`version\`, under Additional commands.`,
  ].join("\n\n");
}

// ---- The source ---------------------------------------------------------------

export type CliPageData = {
  title: string;
  description: string;
  /** The page as Markdown, for the page itself, its Markdown twin and llms-full.txt. */
  markdown: string;
  toc: TOCItemType[];
  structuredData: StructuredData;
};

function pageData(title: string, description: string, markdown: string): CliPageData {
  return {
    title,
    description,
    markdown,
    toc: getTableOfContents(markdown),
    // Search indexes the tables' cells, which the parser finds with GFM only.
    structuredData: structure(markdown, [remarkGfm]),
  };
}

/** The reference's pages, beside the content and the API reference in lib/source.ts. */
export const cliSource: Source<{ pageData: CliPageData; metaData: MetaData }> = {
  files: [
    {
      type: "meta",
      path: `${baseDir}/meta.json`,
      data: {
        title: "CLI reference",
        // A section the sidebar steps down into (components/sidebar.tsx), whose
        // index is its own page, so it is not listed.
        root: true,
        pagesIndex: "index",
        pages: reference.groups.flatMap((group) => {
          const commands = reference.commands.filter((command) => command.group === group);
          if (commands.length === 0) return [];
          return [`---${group}---`, ...commands.map((command) => command.id.split(" ").join("/"))];
        }),
      },
    },
    {
      type: "page",
      path: `${baseDir}/index.mdx`,
      data: pageData("CLI reference", indexDescription, indexMarkdown(reference)),
    },
    ...reference.commands.map((command) => ({
      type: "page" as const,
      path: `${baseDir}/${command.id.split(" ").join("/")}.mdx`,
      data: pageData(
        `${reference.bin} ${command.id}`,
        shortDescription(text(command.description)),
        commandMarkdown(command),
      ),
    })),
  ],
};

/**
 * The sidebar names a command as `zitadel --help` lists it, after the bin,
 * under the reference's own heading; its page keeps the whole command as its
 * title, for the page, its tab, search and llms.txt.
 */
export function cliSidebarNames(): LoaderPlugin {
  const prefix = `${reference.bin} `;
  return {
    name: "cli-sidebar-names",
    transformPageTree: {
      file(node, filePath) {
        if (filePath?.startsWith(`${baseDir}/`) && typeof node.name === "string") {
          if (node.name.startsWith(prefix)) node.name = node.name.slice(prefix.length);
        }
        return node;
      },
    },
  };
}
