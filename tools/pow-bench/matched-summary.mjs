import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "dist/matched");
const corpus = JSON.parse(await readFile(join(dir, "matched-corpus.json"), "utf8"));
const results = JSON.parse(await readFile(join(dir, "matched-browser-results.json"), "utf8"));
const percentile = (values, p = 0.5) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
};
const cell = (values) => [0.5, 0.95, 0.99].map((p) => percentile(values, p).toFixed(2)).join(" / ");
const medianMetric = (group, impl, metric, field = "ns_per_op") =>
  percentile(group.server[impl][metric].map((r) => r[field]));
const lines = [
  "# Matched PoW measurements",
  "",
  `Environment: ${JSON.stringify(results.environment)}; Go ${corpus.go}.`,
  "",
  "Solve milliseconds: nearest-rank p50 / p95 / p99. At n=32 p99 is the maximum, not a stable population tail. Own/ALTCHA ratios use paired samples, not ratios of percentiles. A ratio below 1 favors own code. Cold solves are excluded. Families use different trial ranges: compare within a matched profile, not as equal-security or equal-work algorithms.",
  "",
  "| Profile | Trials | Implementation | Go solve | Chromium solve | WebKit solve |",
  "|---|---:|---|---:|---:|---:|",
];
for (const g of corpus.groups) {
  for (const impl of ["own", "altcha"]) {
    const values = ["chromium", "webkit"].map((name) => {
      const group = results.browsers
        .find((b) => b.name === name)
        ?.groups?.find((b) => b.profile === g.profile.id);
      if (!group) return "unavailable";
      const rows = group.rows.filter((r) => r.implementation === impl);
      if (rows.some((r) => r.timed_out))
        return `${rows.filter((r) => r.timed_out).length}/${rows.length} timed out`;
      return cell(rows.map((r) => r.ms));
    });
    lines.push(
      `| ${g.profile.id} | ${g.profile.trials} | ${impl} | ${cell(g.samples.map((s) => s[impl === "own" ? "native_own_ms" : "native_altcha_ms"]))} | ${values.join(" | ")} |`,
    );
  }
}
lines.push(
  "",
  "Paired median own/ALTCHA solve ratios and browser/Go ratios for own code:",
  "",
  "| Profile | Go own/ALTCHA | Chromium own/ALTCHA | WebKit own/ALTCHA | Chromium/Go own | WebKit/Go own |",
  "|---|---:|---:|---:|---:|---:|",
);
for (const g of corpus.groups) {
  const pairs = ["chromium", "webkit"].map((name) => {
    const measured = results.browsers
      .find((b) => b.name === name)
      ?.groups?.find((b) => b.profile === g.profile.id);
    if (!measured) return null;
    const own = measured.rows.filter((r) => r.implementation === "own" && !r.timed_out);
    return own
      .map((r) => {
        const lib = measured.rows.find(
          (l) => l.implementation === "altcha" && l.index === r.index && !l.timed_out,
        );
        return lib ? [r.ms / lib.ms, r.ms / g.samples[r.index].native_own_ms] : null;
      })
      .filter(Boolean);
  });
  lines.push(
    `| ${g.profile.id} | ${percentile(g.samples.map((s) => s.native_own_ms / s.native_altcha_ms)).toFixed(3)} | ${[...pairs.map((p) => (p ? percentile(p.map((v) => v[0])).toFixed(3) : "n/a")), ...pairs.map((p) => (p ? percentile(p.map((v) => v[1])).toFixed(3) : "n/a"))].join(" | ")} |`,
  );
}
lines.push(
  "",
  "Server microseconds/op: median of three repeated batch means. Decode includes strict parsing of the stored challenge, not proof parsing or database/HTTP admission. Bytes/allocations are Go allocations per issuance; not live memory.",
  "",
  "| Profile | Implementation | Issue | Verify | Bad work | Decode + verify | Issue bytes / allocations |",
  "|---|---|---:|---:|---:|---:|---:|",
);
for (const g of corpus.groups) {
  for (const impl of ["own", "altcha"]) {
    lines.push(
      `| ${g.profile.id} | ${impl} | ${["issue", "verify", "bad_work", "decode_verify"].map((m) => (medianMetric(g, impl, m) / 1000).toFixed(2)).join(" | ")} | ${medianMetric(g, impl, "issue", "bytes_per_op").toFixed(0)} / ${medianMetric(g, impl, "issue", "allocs_per_op").toFixed(0)} |`,
    );
  }
}
lines.push(
  "",
  "Separate issuer processes; three issuance calls per worker, synchronized starts. Sampled heap is a 200 µs observation, RSS is the process high-water mark including runtime. GC and scheduling make these illustrative, not capacity bounds.",
  "",
  "| Profile | Implementation | Concurrency | Peak heap MiB | Max RSS MiB |",
  "|---|---|---:|---:|---:|",
);
for (const r of results.memory_probes) {
  lines.push(
    `| ${r.profile} | ${r.implementation} | ${r.concurrency} | ${(r.sampled_peak_heap_bytes / 1048576).toFixed(2)} | ${r.max_rss_bytes ? (r.max_rss_bytes / 1048576).toFixed(2) : "unavailable"} |`,
  );
}
lines.push("", "Browser checks and limitations:", "");
for (const b of results.browsers) {
  if (b.launch_error) {
    lines.push(`- ${b.name}: unavailable; launch error recorded in raw JSON.`);
    continue;
  }
  const maxGap = Math.max(...b.groups.map((g) => g.main_thread_max_interval_ms));
  const proofCount = b.groups.flatMap((g) => g.rows).filter((r) => !r.timed_out).length;
  const timeouts = b.groups.flatMap((g) => g.rows).filter((r) => r.timed_out).length;
  lines.push(
    `- ${b.name} ${b.version}: ${proofCount} proofs verified in Go, ${timeouts} timeouts; largest 10 ms main-thread timer interval ${maxGap.toFixed(2)} ms. No-WASM CSP probe: ${b.csp_probe?.error ? "blocked as expected" : "NOT blocked"}.`,
  );
  for (const family of ["pbkdf2_5000", "argon2id_4m", "argon2id_16m", "argon2id_64m"]) {
    const g = b.groups.find((g) => g.profile === `${family}_l1`);
    const memory = Math.max(...g.rows.map((r) => r.wasm_linear_bytes));
    lines.push(
      `  - ${family}: observed peak linear memory instantiated within one KDF call ${(memory / 1048576).toFixed(2)} MiB, not total browser RSS. Cold own/ALTCHA solve ${g.cold.own.ms.toFixed(2)} / ${g.cold.altcha.ms.toFixed(2)} ms; worker startup ${g.startup_ms.own.toFixed(2)} / ${g.startup_ms.altcha.toFixed(2)} ms.`,
    );
  }
}
await writeFile(join(dir, "summary.md"), `${lines.join("\n")}\n`);
process.stdout.write(`Wrote ${join(dir, "summary.md")}\n`);
