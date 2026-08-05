export interface CliEnvelope<TData> {
  cli_version?: string;
  command?: string;
  source?: string;
  status: string;
  data: TData;
  warnings?: string[];
  /** Error envelopes (`status: "error"`) carry remediation guidance. */
  code?: string;
  message?: string;
  hint?: string;
  next_commands?: string[];
}

/**
 * Render an error envelope's remediation fields for humans — the CLI's
 * `hint`/`next_commands` are the actionable part of a failure (e.g. "Reinstall
 * @zitadel/cli so npm can install @zitadel/server"), so surface them instead
 * of a raw stdout dump. Returns undefined when the envelope has no message.
 */
export function describeEnvelopeError(envelope: CliEnvelope<unknown>): string | undefined {
  if (typeof envelope.message !== "string" || envelope.message.length === 0) {
    return undefined;
  }
  const lines = [envelope.code ? `${envelope.code}: ${envelope.message}` : envelope.message];
  if (envelope.hint) {
    lines.push(`hint: ${envelope.hint}`);
  }
  if (envelope.next_commands && envelope.next_commands.length > 0) {
    lines.push(`next: ${envelope.next_commands.join(" | ")}`);
  }
  return lines.join("\n");
}

export interface StartEnvelopeData {
  runtime: {
    backend: string;
    pid: number;
    port: number;
    data_dir: string;
    log_path: string;
  };
  urls: {
    api: string;
    console: string;
    login: string;
  };
}

export function parseCliEnvelope<TData>(stdout: string, context: string): CliEnvelope<TData> {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error(
      `${context}: expected a JSON envelope on stdout, got:\n${stdout.trim() || "(empty)"}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start, end + 1));
  } catch (error) {
    throw new Error(
      `${context}: failed to parse JSON envelope: ${(error as Error).message}\n${stdout.trim()}`,
      { cause: error },
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { status?: unknown }).status !== "string"
  ) {
    throw new Error(`${context}: stdout JSON is not a CLI envelope:\n${stdout.trim()}`);
  }
  return parsed as CliEnvelope<TData>;
}
