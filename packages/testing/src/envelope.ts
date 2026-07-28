export interface CliEnvelope<TData> {
  cli_version?: string;
  command?: string;
  source?: string;
  status: string;
  data: TData;
  warnings?: string[];
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
