import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "dist");
const corpus = JSON.parse(await readFile(join(dir, "corpus.json"), "utf8"));
const results = JSON.parse(await readFile(join(dir, "browser-results.json"), "utf8"));
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
const cell = (values) => [0.5, 0.95, 0.99].map((p) => percentile(values, p).toFixed(2)).join(" / ");
const lines = [
  "# Recorded PoW measurements",
  "",
  `Environment: ${JSON.stringify(results.environment)}`,
  "",
  "Times in milliseconds; nearest-rank p50 / p95 / p99. At n=32, p99 is the maximum, not a stable population estimate.",
  "",
  "| Candidate | Native Go | Browser / variant | Browser solve | Samples | Median paired browser/native ratio |",
  "|---|---:|---|---:|---:|---:|",
];
for (const group of corpus.groups) {
  for (const browser of results.browsers) {
    for (const measured of browser.groups.filter((row) => row.candidate === group.candidate.name)) {
      const native = measured.rows.map((row) => group.samples[row.index].native_ms);
      const ratios = measured.rows.map((row) => row.ms / group.samples[row.index].native_ms);
      lines.push(
        `| ${group.candidate.name} | ${cell(native)} | ${browser.name} ${browser.version} / ${measured.variant} | ${cell(measured.rows.map((row) => row.ms))} | ${measured.rows.length} | ${percentile(ratios, 0.5).toFixed(1)}x |`,
      );
    }
  }
}
lines.push(
  "",
  "Server microseconds/op; includes scope/config checks, excludes persistence, network and rate guards.",
  "",
  "| Candidate | Issue | Verify | Decode + verify | Bad work | Bad signature | Verify bytes / allocations | Challenge / proof bytes (first fixture) |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
);
for (const group of corpus.groups) {
  const cost = [
    "issue",
    "verify_valid",
    "decode_and_verify",
    "verify_bad_work",
    "verify_bad_signature",
  ].map((key) => (group.server[key].ns_per_op / 1000).toFixed(2));
  const memory = group.server.verify_valid;
  lines.push(
    `| ${group.candidate.name} | ${cost.join(" | ")} | ${memory.bytes_per_op.toFixed(0)} / ${memory.allocs_per_op.toFixed(0)} | ${Buffer.byteLength(JSON.stringify(group.samples[0].challenge))} / ${Buffer.byteLength(JSON.stringify(group.samples[0].proof))} |`,
  );
}
lines.push("", "Worker checks:", "");
for (const browser of results.browsers) {
  const gap = Math.max(...browser.groups.map((group) => group.main_thread_max_interval_ms));
  lines.push(
    `- ${browser.name}: startup ${browser.checks.startup_ms.toFixed(2)} ms; terminate call ${browser.checks.terminate_call_ms.toFixed(2)} ms; maximum observed 10 ms main-thread timer interval ${gap.toFixed(2)} ms; digest vector ${browser.checks.digest}.`,
  );
}
await writeFile(join(dir, "summary.md"), `${lines.join("\n")}\n`);
process.stdout.write(`${lines.join("\n")}\n`);
