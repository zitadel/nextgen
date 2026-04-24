import { EXIT_CODES, type ZitadelErrorCode } from "../lib/errors";

export type FlagSpec = {
  name: string;
  alias?: string;
  type: "string" | "boolean" | "string[]";
  description: string;
  default?: string | boolean;
};

export type CommandSpec = {
  name: string;
  summary: string;
  usage: string;
  flags: FlagSpec[];
  agent_status: "supported" | "supported-mock-default" | "handoff";
  notes?: string;
};

const globalFlags: FlagSpec[] = [
  { name: "cwd", alias: "c", type: "string", description: "Project directory to operate on." },
  { name: "json", alias: "j", type: "boolean", description: "Emit the JSON envelope instead of pretty output." },
  { name: "non-interactive", alias: "n", type: "boolean", description: "Disable prompts. Required when scripting or running as an agent." },
  { name: "dry-run", type: "boolean", description: "Preview the work without mutating files or hitting the platform." },
  { name: "force", alias: "f", type: "boolean", description: "Overwrite protected files when conflicts are detected." },
  { name: "server", alias: "s", type: "string", description: "Override the resolved server URL (or \"mock\")." },
  { name: "mock", type: "boolean", description: "Alias for --server mock." },
];

export const COMMANDS: CommandSpec[] = [
  {
    name: "setup",
    summary: "Create a pre-claim project and scaffold local auth.",
    usage: "zitadel setup [--framework next] [--user-fields ...] [--auth-methods ...]",
    agent_status: "supported-mock-default",
    flags: [
      ...globalFlags,
      { name: "framework", type: "string", description: "Framework to target (v1 supports \"next\")." },
      { name: "user-fields", type: "string", description: "Comma-separated list of user fields." },
      { name: "auth-methods", type: "string", description: "Comma-separated list of auth methods." },
      { name: "skip-deploy-platform", type: "boolean", description: "Skip deploy platform detection and connect." },
      { name: "platform", type: "string", description: "Deploy platform override (vercel/netlify/cloudflare/none)." },
      { name: "manual", type: "boolean", description: "Emit manual deploy steps instead of configuring the provider." },
      { name: "no-apply", type: "boolean", description: "Skip the automatic apply at the end of setup." },
    ],
  },
  {
    name: "plan",
    summary: "Validate config and deploy readiness without mutation.",
    usage: "zitadel plan [--environment development|preview|production]",
    agent_status: "supported",
    flags: [
      ...globalFlags,
      { name: "environment", alias: "e", type: "string", description: "Target environment (default: development)." },
      { name: "platform", type: "string", description: "Deploy platform override." },
    ],
  },
  {
    name: "apply",
    summary: "Validate and upload repo config to the platform.",
    usage: "zitadel apply [--environment development|preview|production]",
    agent_status: "supported-mock-default",
    flags: [
      ...globalFlags,
      { name: "environment", alias: "e", type: "string", description: "Target environment (default: development)." },
      { name: "platform", type: "string", description: "Deploy platform override." },
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
    name: "deploy status",
    summary: "Report deploy platform readiness.",
    usage: "zitadel deploy status [--platform vercel|netlify|cloudflare]",
    agent_status: "supported",
    flags: [
      ...globalFlags,
      { name: "platform", type: "string", description: "Force a deploy platform adapter." },
      { name: "environment", alias: "e", type: "string", description: "Target environment (default: preview)." },
    ],
  },
  {
    name: "deploy connect",
    summary: "Configure preview or production platform env vars.",
    usage: "zitadel deploy connect [--environment preview|production]",
    agent_status: "supported",
    flags: [
      ...globalFlags,
      { name: "platform", type: "string", description: "Force a deploy platform adapter." },
      { name: "environment", alias: "e", type: "string", description: "Target environment (default: preview)." },
      { name: "manual", type: "boolean", description: "Emit manual steps instead of configuring." },
    ],
  },
  {
    name: "claim",
    summary: "Begin the human handoff to claim the project.",
    usage: "zitadel claim",
    agent_status: "handoff",
    notes: "Agents must stop here and hand the claim URL to a human.",
    flags: globalFlags,
  },
  {
    name: "add schema",
    summary: "Add or remove fields on the user schema.",
    usage: "zitadel add schema [--add-field-json '{...}' | --add-field name:type:attrs] [--remove-field name]",
    agent_status: "supported",
    flags: [
      ...globalFlags,
      { name: "add-field", type: "string[]", description: "Add a field using the colon-DSL (name:type:key=value,...)." },
      { name: "add-field-json", type: "string[]", description: "Add a field using a JSON object. Preferred for agents." },
      { name: "remove-field", type: "string[]", description: "Remove a field by name." },
    ],
  },
  {
    name: "capabilities",
    summary: "Describe the CLI contract (commands, flags, exit codes). Agent introspection target.",
    usage: "zitadel capabilities [--json]",
    agent_status: "supported",
    flags: globalFlags,
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

export function listErrorCodes(): ZitadelErrorCode[] {
  return Object.keys(EXIT_CODES) as ZitadelErrorCode[];
}

export function findCommandSpec(name: string): CommandSpec | undefined {
  return COMMANDS.find((spec) => spec.name === name);
}
