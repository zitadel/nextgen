/**
 * Describes a single flag for help rendering and the generated `AGENTS.md`.
 * `name` is the long form without the leading `--`; `type` drives how the value
 * placeholder is shown. This is documentation metadata only — actual parsing
 * lives in the arg parser, so a flag listed here must be wired up there too.
 */
export type FlagSpec = {
  name: string;
  alias?: string;
  type: "string" | "boolean" | "string[]";
  description: string;
  default?: string | boolean;
};

/**
 * The contract for one CLI command as surfaced to humans (help) and agents
 * (`AGENTS.md`, `help --json`). `name` must match the token the dispatcher
 * routes on, and `agent_status` signals whether agents can rely on the command
 * or should treat it as an experimental surface.
 */
export type CommandSpec = {
  name: string;
  summary: string;
  usage: string;
  flags: FlagSpec[];
  agent_status: "supported" | "supported-mock-default" | "experimental";
  notes?: string;
};

const globalFlags: FlagSpec[] = [
  { name: "cwd", alias: "c", type: "string", description: "Project directory to operate on." },
  {
    name: "json",
    alias: "j",
    type: "boolean",
    description: "Emit the JSON envelope instead of pretty output.",
  },
  {
    name: "non-interactive",
    alias: "n",
    type: "boolean",
    description: "Disable prompts. Required when scripting or running as an agent.",
  },
  {
    name: "dry-run",
    type: "boolean",
    description: "Preview the work without mutating files or hitting the platform.",
  },
  {
    name: "force",
    alias: "f",
    type: "boolean",
    description: "Overwrite protected files when conflicts are detected.",
  },
  {
    name: "server",
    alias: "s",
    type: "string",
    description: "Override the resolved server URL.",
  },
];

/**
 * The canonical, ordered list of public commands. This is the single source of
 * truth for help output and the generated `AGENTS.md`; the dispatcher in
 * `cli.ts` must stay in sync with these names. Order here is the order shown to
 * users, so it reflects the intended golden path rather than alphabetical.
 */
export const COMMANDS: CommandSpec[] = [
  {
    name: "setup",
    summary: "Create a Zitadel project and scaffold local auth.",
    usage: "zitadel setup [--framework next] [--user-fields ...] [--auth-method passkey|password]",
    agent_status: "supported-mock-default",
    flags: [
      ...globalFlags,
      {
        name: "framework",
        type: "string",
        description: 'Framework to target (v1 supports "next").',
      },
      { name: "user-fields", type: "string", description: "Comma-separated list of user fields." },
      {
        name: "auth-method",
        type: "string",
        description: "Auth method to scaffold: `passkey` (default) or `password`.",
      },
      {
        name: "renderer",
        type: "string",
        description: "Renderer: react (default) or web-component (planned <zitadel-flow>).",
      },
      {
        name: "no-apply",
        type: "boolean",
        description: "Skip the automatic apply at the end of setup.",
      },
    ],
  },
  {
    name: "plan",
    summary: "Validate config without mutation and preview the sync diff.",
    usage: "zitadel plan [--environment development|preview|production]",
    agent_status: "supported",
    flags: [
      ...globalFlags,
      {
        name: "environment",
        alias: "e",
        type: "string",
        description: "Target environment (default: development).",
      },
    ],
  },
  {
    name: "apply",
    summary: "Validate and upload repo config to the platform.",
    usage: "zitadel apply [--environment development|preview|production]",
    agent_status: "supported-mock-default",
    flags: [
      ...globalFlags,
      {
        name: "environment",
        alias: "e",
        type: "string",
        description: "Target environment (default: development).",
      },
    ],
  },
  {
    name: "doctor",
    summary: "Verify generated files and local state.",
    usage: "zitadel doctor [--fix]",
    agent_status: "supported",
    flags: [
      ...globalFlags,
      { name: "fix", type: "boolean", description: "Re-apply missing managed files." },
    ],
  },
  {
    name: "help",
    summary: "Show help for the CLI or a specific command.",
    usage: "zitadel help [command]",
    agent_status: "supported",
    flags: globalFlags,
  },
  {
    name: "status",
    summary: "Summarize the local project state.",
    usage: "zitadel status",
    agent_status: "supported",
    flags: globalFlags,
  },
  {
    name: "eject",
    summary: "Remove managed files and local Zitadel state.",
    usage: "zitadel eject [--force]",
    agent_status: "supported",
    notes: "Does not delete the remote project. Back up .env.local before removing.",
    flags: globalFlags,
  },
];

/**
 * Looks up a command spec by its exact dispatch name (e.g. `"deploy status"`).
 * Returns `undefined` for unknown names so callers can render an
 * "unknown command" message rather than throwing.
 */
export function findCommandSpec(name: string): CommandSpec | undefined {
  return COMMANDS.find((spec) => spec.name === name);
}
