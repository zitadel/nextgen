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
  agent_status: "supported" | "supported-mock-default" | "handoff" | "experimental";
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
      { name: "renderer", type: "string", description: "Renderer: react (default) or web-component (planned <zitadel-flow>)." },
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
    agent_status: "experimental",
    notes: "Experimental POC surface; agents should prefer setup, plan, apply, and claim for the golden path.",
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
    agent_status: "experimental",
    notes: "Experimental POC surface; agents should prefer setup, plan, apply, and claim for the golden path.",
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
    name: "claim status",
    summary: "Check a human claim handoff and refresh local claimed state.",
    usage: "zitadel claim status --challenge-id <id>",
    agent_status: "supported-mock-default",
    flags: [
      ...globalFlags,
      { name: "challenge-id", type: "string", description: "Claim challenge ID returned by `zitadel claim`." },
      { name: "mock-complete-claim", type: "boolean", description: "Mock-only: complete the claim handoff and refresh local state." },
      { name: "mock-advance-claim", type: "boolean", description: "Alias for --mock-complete-claim." },
    ],
  },
  {
    name: "schema add",
    summary: "Add or remove fields on the user schema.",
    usage: "zitadel schema add [--preset name] [--add-field-json '{...}' | --add-field name:type:attrs] [--remove-field name]",
    agent_status: "supported",
    notes: "Aliased as `zitadel add schema`.",
    flags: [
      ...globalFlags,
      { name: "preset", type: "string[]", description: "Apply a named field preset (run `zitadel capabilities` for the list)." },
      { name: "add-field", type: "string[]", description: "Add a field using the colon-DSL (name:type:key=value,...)." },
      { name: "add-field-json", type: "string[]", description: "Add a field using a JSON object. Preferred for agents." },
      { name: "remove-field", type: "string[]", description: "Remove a field by name." },
    ],
  },
  {
    name: "idp add",
    summary: "Add or update an identity provider (.zitadel/idps/<slug>.json).",
    usage: "zitadel idp add (--preset google|microsoft|okta-oidc | --protocol oidc|saml) [--slug] [--issuer] [--client-id] [--env-secret] [--metadata-url]",
    agent_status: "experimental",
    notes: "Experimental POC surface; presets are limited to providers with an OIDC issuer.",
    flags: [
      ...globalFlags,
      { name: "slug", type: "string", description: "Local slug (filename). Defaults to preset id." },
      { name: "display-name", type: "string", description: "Human-readable IdP name." },
      { name: "protocol", type: "string", description: "Protocol: oidc or saml." },
      { name: "preset", type: "string", description: "Preset: google, microsoft, okta-oidc." },
      { name: "issuer", type: "string", description: "OIDC issuer URL (required with --protocol oidc or okta-oidc preset)." },
      { name: "client-id", type: "string", description: "OIDC client ID." },
      { name: "env-secret", type: "string", description: "Name of env var holding the OIDC client secret (e.g. ZITADEL_IDP_GOOGLE_SECRET)." },
      { name: "metadata-url", type: "string", description: "SAML metadata URL." },
      { name: "scopes", type: "string", description: "Comma-separated OIDC scopes." },
      { name: "from-file", type: "string", description: "Path to an existing IdP resource JSON file." },
    ],
  },
  {
    name: "idp list",
    summary: "List local IdP resources.",
    usage: "zitadel idp list",
    agent_status: "experimental",
    notes: "Experimental POC surface.",
    flags: globalFlags,
  },
  {
    name: "idp show",
    summary: "Show a single IdP resource by slug.",
    usage: "zitadel idp show <slug>",
    agent_status: "experimental",
    notes: "Experimental POC surface.",
    flags: globalFlags,
  },
  {
    name: "idp remove",
    summary: "Remove an IdP resource by slug.",
    usage: "zitadel idp remove <slug>",
    agent_status: "experimental",
    notes: "Experimental POC surface.",
    flags: globalFlags,
  },
  {
    name: "locale scaffold",
    summary: "Add missing text_key entries to .zitadel/locales/<lang>.json (idempotent).",
    usage: "zitadel locale scaffold [--lang en]",
    agent_status: "supported",
    notes: "Walks .zitadel/flows/*.json, extracts every text_key, adds missing keys with empty strings.",
    flags: [
      ...globalFlags,
      { name: "lang", type: "string", description: "Target locale code (default: en)." },
    ],
  },
  {
    name: "locale list",
    summary: "List local .zitadel/locales/*.json files with key counts.",
    usage: "zitadel locale list",
    agent_status: "supported",
    flags: globalFlags,
  },
  {
    name: "app add",
    summary: "Add or update an app resource (.zitadel/apps/<slug>.json). Apps consume Zitadel's OIDC/SAML server.",
    usage: "zitadel app add (--preset spa|web|native|machine | --protocol oidc|saml) [--slug <slug>] [--redirect-uri ...]",
    agent_status: "experimental",
    notes: "Experimental POC surface.",
    flags: [
      ...globalFlags,
      { name: "slug", type: "string", description: "Local slug (filename)." },
      { name: "display-name", type: "string", description: "Human-readable app name." },
      { name: "protocol", type: "string", description: "Protocol: oidc or saml." },
      { name: "preset", type: "string", description: "Preset: spa, web, native, machine." },
      { name: "client-type", type: "string", description: "OIDC client_type: web, spa, native, machine (default: spa). Use with --protocol oidc." },
      { name: "role", type: "string", description: "SAML role: client (default) or server (Zitadel-as-IdP). Rejected for OIDC — use --client-type." },
      { name: "redirect-uri", type: "string[]", description: "Redirect URI (repeatable). OIDC only." },
      { name: "post-logout-redirect-uri", type: "string[]", description: "Post-logout redirect URI (repeatable). OIDC only." },
      { name: "metadata-url", type: "string", description: "SAML metadata URL." },
      { name: "entity-id", type: "string", description: "SAML entity ID." },
      { name: "from-file", type: "string", description: "Path to an existing app resource JSON file." },
    ],
  },
  {
    name: "app list",
    summary: "List local app resources.",
    usage: "zitadel app list",
    agent_status: "experimental",
    notes: "Experimental POC surface.",
    flags: globalFlags,
  },
  {
    name: "app show",
    summary: "Show a single app resource by slug.",
    usage: "zitadel app show <slug>",
    agent_status: "experimental",
    notes: "Experimental POC surface.",
    flags: globalFlags,
  },
  {
    name: "app remove",
    summary: "Remove an app resource by slug.",
    usage: "zitadel app remove <slug>",
    agent_status: "experimental",
    notes: "Experimental POC surface.",
    flags: globalFlags,
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
