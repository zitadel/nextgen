import { getTableOfContents } from "fumadocs-core/content/toc";
import { remarkGfm, type StructuredData, structure } from "fumadocs-core/mdx-plugins";
import { getSlugs, type LoaderPlugin, type MetaData, type Source } from "fumadocs-core/source";
import type { TOCItemType } from "fumadocs-core/toc";

// The CLI's commands, from the reference its test keeps current
// (apps/cli/command-reference.json), bundled by scripts/bundle-cli.mjs and
// imported as a module, so it ships inside the build.
import reference from "../.generated/cli.mjs";
import { cli, cliCommand } from "./cli-sample.ts";
import { shortDescription } from "./description.ts";
import type { openapi } from "./openapi.ts";

// The CLI reference: a page per command, under /docs/reference/cli, in the
// groups and the order `zitadel --help` lists them, and an index with the
// flags every command takes. A page is Markdown, the same text for the page
// (components/cli-page.tsx), its Markdown twin and search. A command that
// calls the API links the operation it calls.

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

/** An environment variable that sets what a global flag sets. */
export type CliVariable = { name: string; flag: string; description: string; precedence: string };

export type CliReference = {
  bin: string;
  groups: string[];
  globalFlags: CliFlag[];
  env: CliVariable[];
  /** The exit code of each error `code` an envelope can carry. */
  exitCodes: Record<string, number>;
  commands: CliCommand[];
};

const baseDir = "reference/cli";
const indexUrl = "/docs/reference/cli";

/** A command's page: `users list` is /docs/reference/cli/users/list. */
export function cliCommandUrl(command: string) {
  return `${indexUrl}/${command.split(" ").join("/")}`;
}

/** The API operation a command calls, and the pages of the operation and of its tag. */
type CliOperation = {
  title: string;
  /** `POST /users`. */
  endpoint: string;
  url: string;
  tag: { title: string; url: string };
};

/**
 * Each command's operation, from the API reference's operation pages: an
 * operation names the command that calls it in `x-zitadel-cli`
 * (lib/cli-sample.ts), and the CLI's api-coverage test keeps it to one
 * operation a command.
 */
export function commandOperations({ files }: Awaited<ReturnType<typeof openapi.staticSource>>) {
  const operations = new Map<string, CliOperation>();
  for (const file of files) {
    if (file.type !== "page") continue;
    const { bundled } = file.data.getSchema();
    const slugs = getSlugs(file.path);
    for (const { method, path } of file.data.getOpenAPIPageProps().operations ?? []) {
      const operation = bundled.paths?.[path]?.[method];
      const command = operation && cliCommand(operation);
      if (!operation || !command) continue;
      const endpoint = `${method.toUpperCase()} ${path}`;
      operations.set(command, {
        title: file.data.title ?? endpoint,
        endpoint,
        url: `/docs/${slugs.join("/")}`,
        // The tag's folder holds its operations, and its index is the tag's page.
        tag: {
          title: sectionName(operation.tags?.[0] ?? ""),
          url: `/docs/${slugs.slice(0, -1).join("/")}`,
        },
      });
    }
  }
  return operations;
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

// The first column is Markdown already, a name or a link; the others are text.
function table(head: string[], rows: string[][]) {
  return [
    `| ${head.join(" | ")} |`,
    `|${" --- |".repeat(head.length)}`,
    ...rows.map(([first, ...rest]) => `| ${[first, ...rest.map(cell)].join(" | ")} |`),
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

// The help's sections are capitalised (`REQUIRED FIELD`), as are the API's
// tags (`Flow Definitions`); a heading is in sentence case, except for an
// abbreviation.
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

/**
 * A command's page, as Markdown. llms-full.txt leaves the operations out, so
 * there the operation's name is text, and the link is to its tag's page.
 */
function commandMarkdown(
  command: CliCommand,
  operation: CliOperation | undefined,
  { linkOperation }: { linkOperation: boolean },
) {
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

  if (operation) {
    const name = linkOperation
      ? `[${text(operation.title)}](${operation.url})`
      : text(operation.title);
    const tag = `[${operation.tag.title}](${operation.tag.url})`;
    sections.push("## API", `It calls ${name}, ${code(operation.endpoint)}, in the ${tag} API.`);
  }
  return sections.join("\n\n");
}

const indexDescription = "Every zitadel command, with its flags and examples.";

// The variables that stand in for a global flag, with how each ranks against it.
function variableTable(variables: CliVariable[]) {
  return table(
    ["Variable", "Flag", "Description", "Precedence"],
    variables.map((variable) => [
      code(variable.name),
      code(`--${variable.flag}`),
      variable.description,
      variable.precedence,
    ]),
  );
}

// A row per exit code, lowest first, with the error codes that end in it.
function exitCodeTable(exitCodes: Record<string, number>) {
  const codes = [...new Set(Object.values(exitCodes))].sort((a, b) => a - b);
  return table(
    ["Exit code", "Error codes"],
    codes.map((exit) => [
      code(String(exit)),
      list(Object.keys(exitCodes).filter((error) => exitCodes[error] === exit)),
    ]),
  );
}

/**
 * The reference's own page: how to run a command, the global flags with the
 * environment variables that stand in for them, the exit codes, the commands.
 */
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
    "## Environment variables",
    "These set what a global flag sets, for every command.",
    variableTable(cliReference.env),
    "## Exit codes",
    "A command that succeeds, or skips because there is nothing to do, exits `0`. One that fails exits with the code of the error its envelope names in `code`.",
    exitCodeTable(cliReference.exitCodes),
    ...groups,
    `\`${cli} --help\` also lists oclif's own commands, such as \`help\` and \`version\`, under Additional commands.`,
  ].join("\n\n");
}

// ---- The source ---------------------------------------------------------------

export type CliPageData = {
  title: string;
  description: string;
  /** The page as Markdown, for the page itself, its Markdown twin and the MCP server. */
  markdown: string;
  /** The page in llms-full.txt. */
  llmsFullMarkdown: string;
  toc: TOCItemType[];
  structuredData: StructuredData;
};

function pageData(
  title: string,
  description: string,
  markdown: string,
  llmsFullMarkdown = markdown,
): CliPageData {
  return {
    title,
    description,
    markdown,
    llmsFullMarkdown,
    toc: getTableOfContents(markdown),
    // Search indexes the tables' cells, which the parser finds with GFM only.
    structuredData: structure(markdown, [remarkGfm]),
  };
}

/**
 * The reference's pages, beside the content and the API reference in
 * lib/source.ts. A command's page links the operation it calls.
 */
export const cliSource = (
  operations: Map<string, CliOperation>,
): Source<{ pageData: CliPageData; metaData: MetaData }> => ({
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
        commandMarkdown(command, operations.get(command.id), { linkOperation: true }),
        commandMarkdown(command, operations.get(command.id), { linkOperation: false }),
      ),
    })),
  ],
});

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
