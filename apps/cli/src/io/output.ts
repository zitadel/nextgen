import type { ZitadelError } from "../lib/errors";

export type EnvelopeMeta = {
  cli_version: string;
  command: string;
  source: string;
};

export type OkEnvelope<T> = EnvelopeMeta & {
  status: "ok";
  data: T;
  warnings?: string[];
};
export type ErrorEnvelope = EnvelopeMeta & {
  status: "error";
  code: string;
  message: string;
  hint?: string;
  next_commands?: string[];
  details?: unknown;
};
export type SkippedEnvelope = EnvelopeMeta & {
  status: "skipped";
  reason: string;
  data?: unknown;
  next_commands?: string[];
};
export type JsonEnvelope<T> = OkEnvelope<T> | ErrorEnvelope | SkippedEnvelope;

export type CliIO = {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
};

export type GlobalOptions = {
  cwd: string;
  json: boolean;
  nonInteractive: boolean;
  dryRun: boolean;
  force: boolean;
  command: string;
  cliVersion: string;
  source: string;
  serverFlag?: string;
};

export const defaultIO: CliIO = {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  isTTY: Boolean(process.stdout.isTTY && process.stdin.isTTY),
};

export function writeJson<T>(io: CliIO, envelope: JsonEnvelope<T>): void {
  io.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

export function writePretty(io: CliIO, message: string): void {
  io.stdout.write(`${message}\n`);
}

export function writeError(io: CliIO, error: ZitadelError, opts: GlobalOptions): void {
  const envelope: ErrorEnvelope = {
    status: "error",
    cli_version: opts.cliVersion,
    command: opts.command,
    source: opts.source,
    code: error.code,
    message: error.message,
    hint: error.hint,
    next_commands: error.nextCommands,
    details: error.details,
  };

  if (opts.json) {
    writeJson(io, envelope);
    return;
  }

  io.stderr.write(`Error ${error.code}: ${error.message}\n`);
  if (error.hint) {
    io.stderr.write(`${error.hint}\n`);
  }
  if (error.nextCommands && error.nextCommands.length > 0) {
    io.stderr.write(`Next:\n`);
    for (const cmd of error.nextCommands) {
      io.stderr.write(`  $ ${cmd}\n`);
    }
  }
}

export function ok<T>(io: CliIO, data: T, opts: GlobalOptions, warnings: string[] = []): void {
  if (opts.json) {
    writeJson(io, {
      status: "ok",
      cli_version: opts.cliVersion,
      command: opts.command,
      source: opts.source,
      data,
      warnings,
    });
    return;
  }

  writePretty(io, formatData(data, warnings, opts));
}

export function skipped(io: CliIO, reason: string, opts: GlobalOptions, data?: unknown, nextCommands?: string[]): void {
  if (opts.json) {
    writeJson(io, {
      status: "skipped",
      cli_version: opts.cliVersion,
      command: opts.command,
      source: opts.source,
      reason,
      data,
      next_commands: nextCommands,
    });
    return;
  }

  writePretty(io, `Skipped: ${reason}${suffixBlock(opts)}`);
  if (nextCommands && nextCommands.length > 0) {
    writePretty(io, `Next:`);
    for (const cmd of nextCommands) {
      writePretty(io, `  $ ${cmd}`);
    }
  }
}

function formatData(data: unknown, warnings: string[], opts: GlobalOptions): string {
  if (typeof data === "string") {
    const suffix = sourceSuffix(opts);
    return suffix ? `${data}\n${suffix}` : data;
  }

  const lines: string[] = [];
  const titleLine = isObject(data) && typeof data.title === "string" ? String(data.title) : "Zitadel command completed.";
  lines.push(titleLine);
  const suffix = sourceSuffix(opts);
  if (suffix) lines.push(suffix);

  if (isObject(data)) {
    renderKnownSections(lines, data);

    if (Array.isArray(data.next_actions) && data.next_actions.length > 0) {
      lines.push("");
      lines.push("Next:");
      for (const action of data.next_actions) lines.push(`  ${String(action)}`);
    }
    if (Array.isArray(data.next_commands) && data.next_commands.length > 0) {
      if (!Array.isArray(data.next_actions) || data.next_actions.length === 0) {
        lines.push("");
        lines.push("Next:");
      }
      for (const cmd of data.next_commands) lines.push(`  $ ${String(cmd)}`);
    }
  }

  for (const warning of warnings) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

function renderKnownSections(lines: string[], data: Record<string, unknown>): void {
  if (isObject(data.project)) {
    const project = data.project;
    const segments: string[] = [];
    if (typeof project.project_id === "string") segments.push(`project=${project.project_id}`);
    if (typeof project.lifecycle === "string") segments.push(`lifecycle=${project.lifecycle}`);
    if (typeof project.issuer === "string") segments.push(`issuer=${project.issuer}`);
    if (segments.length > 0) lines.push(`Project: ${segments.join("  ")}`);
    if (typeof project.scratch_dashboard_url === "string") {
      lines.push(`Dashboard: ${project.scratch_dashboard_url}`);
    }
  }

  if (typeof data.framework === "string" || typeof data.package_manager === "string") {
    const parts: string[] = [];
    if (typeof data.framework === "string") parts.push(`framework=${data.framework}`);
    if (typeof data.package_manager === "string") parts.push(`pm=${data.package_manager}`);
    if (parts.length > 0) lines.push(parts.join("  "));
  }

  if (Array.isArray(data.files_written) || Array.isArray(data.files_skipped)) {
    const written = Array.isArray(data.files_written) ? data.files_written.length : 0;
    const skippedCount = Array.isArray(data.files_skipped) ? data.files_skipped.length : 0;
    lines.push(`Files: ${written} written, ${skippedCount} unchanged`);
  }

  if (isObject(data.apply)) {
    const apply = data.apply;
    const bits: string[] = [];
    if (typeof apply.config_version === "number") bits.push(`v${apply.config_version}`);
    if (typeof apply.hash === "string") bits.push(`hash=${String(apply.hash).slice(0, 12)}`);
    if (typeof apply.environment === "string") bits.push(`env=${apply.environment}`);
    if (bits.length > 0) lines.push(`Apply: ${bits.join("  ")}`);
  }

  if (isObject(data.deploy)) {
    const deploy = data.deploy;
    const bits: string[] = [];
    if (typeof deploy.platform === "string") bits.push(deploy.platform);
    if (typeof deploy.environment === "string") bits.push(deploy.environment);
    if (typeof deploy.state === "string") bits.push(`state=${deploy.state}`);
    if ("configured" in deploy) bits.push(`configured=${String((deploy as { configured: unknown }).configured)}`);
    if (bits.length > 0) lines.push(`Deploy: ${bits.join("  ")}`);
  }

  if (Array.isArray(data.checks) && data.checks.length > 0) {
    lines.push("Checks:");
    for (const check of data.checks) {
      if (!isObject(check)) continue;
      const status = check.status === "pass" ? "ok" : "fail";
      lines.push(`  [${status}] ${String(check.name ?? "check")}: ${String(check.message ?? "")}`);
    }
  }
}

function sourceSuffix(opts: GlobalOptions): string {
  if (opts.source === "mock") return "(using mock platform)";
  try {
    const url = new URL(opts.source);
    if (url.host === "api.zitadel.cloud") return "";
    return `(server: ${url.host})`;
  } catch {
    return "";
  }
}

function suffixBlock(opts: GlobalOptions): string {
  const suffix = sourceSuffix(opts);
  return suffix ? ` ${suffix}` : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
