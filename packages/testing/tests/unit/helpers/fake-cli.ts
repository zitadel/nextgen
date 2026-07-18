import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FakeCliBehavior {
  startExitCode?: number;
  startStdout?: string;
  startStderr?: string;
  stopExitCode?: number;
  stopStdout?: string;
  /** Fail the first N stop invocations with exit 1, then succeed. */
  stopFailuresBeforeSuccess?: number;
}

export interface FakeCli {
  binPath: string;
  /** One JSON-encoded argv array per CLI invocation, in order. */
  calls(): Promise<string[][]>;
}

/**
 * Generates a stand-in for the `zitadel` bin: records every argv, then replies
 * per command. `start` echoes the requested --port and -c dir into a realistic
 * envelope unless a canned stdout is provided.
 */
export async function fakeCliBin(behavior: FakeCliBehavior = {}): Promise<FakeCli> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-testing-fake-cli-"));
  const recordPath = join(dir, "calls.jsonl");
  const binPath = join(dir, "fake-zitadel.cjs");
  const script = `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(recordPath)}, JSON.stringify(args) + "\\n");
const command = args[0];
const argValue = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
if (command === "start") {
  process.stderr.write(${JSON.stringify(behavior.startStderr ?? "")});
  const canned = ${JSON.stringify(behavior.startStdout ?? null)};
  if (canned !== null) {
    process.stdout.write(canned);
  } else {
    const port = Number(argValue("--port"));
    const dir = argValue("-c");
    process.stdout.write(JSON.stringify({
      cli_version: "0.0.0-fake",
      command: "start",
      source: "http://localhost:" + port,
      status: "ok",
      data: {
        title: "Local Zitadel server is ready.",
        runtime: {
          backend: "binary",
          pid: 4242,
          log_path: dir + "/.zitadel/local/server.log",
          port,
          data_dir: dir + "/.zitadel/local/nextgen-data",
        },
        urls: {
          api: "http://localhost:" + port,
          console: "http://localhost:" + port + "/ui/console/",
          login: "http://localhost:" + port + "/ui/login/",
        },
      },
      warnings: [],
    }));
  }
  process.exit(${JSON.stringify(behavior.startExitCode ?? 0)});
}
if (command === "stop") {
  const stopCalls = fs.readFileSync(${JSON.stringify(recordPath)}, "utf8")
    .split("\\n")
    .filter((line) => line.startsWith('["stop"')).length;
  if (stopCalls <= ${JSON.stringify(behavior.stopFailuresBeforeSuccess ?? 0)}) {
    process.stderr.write("fake cli: transient stop failure " + stopCalls);
    process.exit(1);
  }
  process.stdout.write(${JSON.stringify(
    behavior.stopStdout ?? '{"status":"ok","command":"stop","data":{"title":"stopped"}}',
  )});
  process.exit(${JSON.stringify(behavior.stopExitCode ?? 0)});
}
process.stderr.write("fake cli: unknown command " + command);
process.exit(64);
`;
  await writeFile(binPath, script, { mode: 0o755 });
  return {
    binPath,
    calls: async () => {
      const raw = await readFile(recordPath, "utf8").catch(() => "");
      return raw
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as string[]);
    },
  };
}
