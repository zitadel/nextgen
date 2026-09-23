import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { tailLogFile } from "../../../../src/lib/run/log-tail";

const dirs: string[] = [];
const tails: Array<{ stop: () => void }> = [];

afterEach(async () => {
  for (const tail of tails.splice(0)) {
    tail.stop();
  }
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function logFile(contents = ""): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-run-tail-"));
  dirs.push(dir);
  const path = join(dir, "server.log");
  await writeFile(path, contents);
  return path;
}

/**
 * Drives the tail by hand rather than by its timer: the polling interval is an
 * implementation detail, and waiting it out would make every case slow and
 * flaky.
 */
function collector(path: string, from?: number) {
  const chunks: string[] = [];
  // A poll interval no test will reach: every case calls `poll` itself.
  const tail = tailLogFile(path, {
    from,
    intervalMs: 60_000,
    onChunk: (chunk) => chunks.push(chunk),
  });
  tails.push(tail);
  return { chunks, poll: tail.poll };
}

describe("tailLogFile", () => {
  it("reads everything appended after the given offset", async () => {
    const path = await logFile("old run\n");
    const { chunks, poll } = collector(path, 0);

    await appendFile(path, "this run\n");
    await poll();

    expect(chunks.join("")).toBe("old run\nthis run\n");
  });

  it("skips what the file already held when no offset is given", async () => {
    const path = await logFile("someone else's session\n");
    const { chunks, poll } = collector(path);

    await poll();
    await appendFile(path, "mine\n");
    await poll();

    expect(chunks.join("")).toBe("mine\n");
  });

  it("emits nothing while the file does not grow", async () => {
    const path = await logFile("line\n");
    const { chunks, poll } = collector(path, 0);

    await poll();
    await poll();

    expect(chunks).toEqual(["line\n"]);
  });

  it("restarts from the beginning when the file was truncated", async () => {
    const path = await logFile("a long first session\n");
    const { chunks, poll } = collector(path, 0);

    await poll();
    await writeFile(path, "restarted\n");
    await poll();

    expect(chunks).toEqual(["a long first session\n", "restarted\n"]);
  });

  it("waits for a log file that does not exist yet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-run-tail-"));
    dirs.push(dir);
    const path = join(dir, "server.log");
    const { chunks, poll } = collector(path, 0);

    await poll();
    expect(chunks).toEqual([]);

    await writeFile(path, "first line\n");
    await poll();
    expect(chunks).toEqual(["first line\n"]);
  });

  it("emits nothing once stopped", async () => {
    const path = await logFile("");
    const chunks: string[] = [];
    const tail = tailLogFile(path, { from: 0, onChunk: (chunk) => chunks.push(chunk) });

    tail.stop();
    await appendFile(path, "after stop\n");
    await tail.poll();

    expect(chunks).toEqual([]);
  });
});
