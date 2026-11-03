import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, release, arch, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = process.env.POW_BENCH_NODE_MODULES
  ? createRequire(join(process.env.POW_BENCH_NODE_MODULES, "../package.json"))
  : createRequire(import.meta.url);
const { build, version: esbuildVersion } = await import(pathToFileURL(require.resolve("esbuild")));
const pw = await import(pathToFileURL(require.resolve("playwright")));
const playwright = pw.default || pw;
const out = join(here, "dist/matched");
const samples = Number(process.env.POW_BENCH_SAMPLES || 32);
const binary = join(out, "pow-bench");
async function command(cmd, args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: here,
      env: process.env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (b) => {
        stdout += b;
      });
      child.stderr.on("data", (b) => {
        stderr += b;
      });
    }
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${cmd} failed ${code}: ${stderr}`)),
    );
  });
}
await mkdir(out, { recursive: true });
await command("go", ["test", "-count=1", "./..."]);
await command("go", ["build", "-o", binary, "."]);
if (!process.argv.includes("--browsers-only"))
  await command(binary, ["--suite=matched", "--samples", String(samples), "--out", out]);
const corpus = JSON.parse(await readFile(join(out, "matched-corpus.json"), "utf8"));
await build({
  entryPoints: [join(here, "matched-worker.mjs")],
  bundle: true,
  outfile: join(out, "worker.js"),
  platform: "browser",
  format: "iife",
  minify: true,
  nodePaths: process.env.POW_BENCH_NODE_MODULES ? [process.env.POW_BENCH_NODE_MODULES] : [],
});
const worker = await readFile(join(out, "worker.js"));
const server = createServer((req, res) => {
  const noWasm = req.url === "/no-wasm-worker.js";
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'self'${noWasm ? "" : " 'wasm-unsafe-eval'"}; worker-src 'self'`,
  );
  res.setHeader("Content-Type", req.url?.endsWith(".js") ? "text/javascript" : "text/html");
  res.end(
    req.url?.endsWith(".js") ? worker : "<!doctype html><title>Matched PoW benchmark</title>",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const results = {
  created_at: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    os_release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logical_cpus: cpus().length,
    memory_bytes: totalmem(),
    esbuild: esbuildVersion,
    worker_bytes: worker.length,
    altcha_go: "2.4.1",
    altcha_js: "2.8.0",
    hash_wasm: require("hash-wasm/package.json").version,
    playwright: require("playwright/package.json").version,
  },
  browsers: [],
  memory_probes: [],
};
const proofs = [];
async function save() {
  await writeFile(
    join(out, "matched-browser-results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  await writeFile(join(out, "matched-browser-proofs.json"), `${JSON.stringify(proofs, null, 2)}\n`);
}
try {
  for (const name of (process.env.POW_BENCH_BROWSERS || "chromium,firefox,webkit").split(",")) {
    let browser;
    try {
      browser = await playwright[name].launch({ headless: true });
    } catch (error) {
      results.browsers.push({
        name,
        launch_error: String(error).split("\n").slice(0, 12).join("\n"),
      });
      await save();
      process.stdout.write(`${name}: launch failed; recorded\n`);
      continue;
    }
    try {
      const page = await browser.newPage();
      await page.goto(url);
      const result = { name, version: browser.version(), groups: [] };
      results.browsers.push(result);
      for (const group of corpus.groups) {
        const rows = await page.evaluate(async (group) => {
          const workers = {};
          const calls = {};
          const startup = {};
          for (const implementation of ["own", "altcha"]) {
            const started = performance.now();
            const worker = new Worker("/worker.js");
            workers[implementation] = worker;
            await new Promise((resolve, reject) => {
              worker.onmessage = resolve;
              worker.onerror = reject;
            });
            startup[implementation] = performance.now() - started;
            calls[implementation] = (sample) =>
              new Promise((resolve, reject) => {
                worker.onmessage = ({ data }) =>
                  data.error ? reject(new Error(data.error)) : resolve(data);
                worker.onerror = reject;
                worker.postMessage({ profile: group.profile, sample, implementation });
              });
          }
          let last = performance.now();
          let maxGap = 0;
          const heartbeat = setInterval(() => {
            const now = performance.now();
            maxGap = Math.max(maxGap, now - last);
            last = now;
          }, 10);
          try {
            const cold = {};
            for (const impl of ["own", "altcha"]) cold[impl] = await calls[impl](group.samples[0]);
            const rows = [];
            for (const [index, sample] of group.samples.entries()) {
              const order = index % 2 === 0 ? ["own", "altcha"] : ["altcha", "own"];
              for (const implementation of order) {
                const start = performance.now();
                const measured = await calls[implementation](sample);
                rows.push({
                  index,
                  implementation,
                  ...measured,
                  wall_ms: performance.now() - start,
                });
              }
            }
            return { rows, cold, startup_ms: startup, main_thread_max_interval_ms: maxGap };
          } finally {
            clearInterval(heartbeat);
            Object.values(workers).forEach((worker) => {
              worker.terminate();
            });
          }
        }, group);
        for (const row of rows.rows) {
          if (!row.timed_out) {
            const expected = group.samples[row.index];
            if (
              row.proof?.derived_key !== expected.proof.derived_key ||
              row.trials !== expected.counter + 1
            )
              throw new Error(`${name} ${group.profile.id}: interop mismatch`);
            proofs.push({
              profile: group.profile.id,
              index: row.index,
              implementation: row.implementation,
              proof: row.proof,
            });
          }
        }
        result.groups.push({ profile: group.profile.id, ...rows });
        await save();
        const p95 = (impl) => {
          const a = rows.rows
            .filter((r) => r.implementation === impl)
            .map((r) => r.ms)
            .sort((a, b) => a - b);
          return a[Math.ceil(0.95 * a.length) - 1].toFixed(1);
        };
        process.stdout.write(
          `${name}: ${group.profile.id} p95 own ${p95("own")} / ALTCHA ${p95("altcha")} ms\n`,
        );
      }
      result.csp_probe = await page.evaluate(
        async (group) => {
          const worker = new Worker("/no-wasm-worker.js");
          await new Promise((resolve, reject) => {
            worker.onmessage = resolve;
            worker.onerror = reject;
          });
          try {
            const response = new Promise((resolve, reject) => {
              worker.onmessage = (event) => resolve(event.data);
              worker.onerror = reject;
            });
            worker.postMessage({
              profile: group.profile,
              sample: group.samples[0],
              implementation: "own",
            });
            return await response;
          } finally {
            worker.terminate();
          }
        },
        corpus.groups.find((g) => g.profile.family === "argon2id_4m"),
      );
      await save();
    } finally {
      await browser.close();
    }
  }
  if (!results.browsers.some((b) => b.groups?.length === corpus.groups.length))
    throw new Error("No complete browser engine");
  await command(binary, [
    "--suite=matched",
    "--out",
    out,
    "--verify",
    join(out, "matched-browser-proofs.json"),
  ]);
  // Separate processes keep high-water RSS from earlier profiles out of these probes.
  for (const family of ["pbkdf2_5000", "argon2id_4m", "argon2id_16m", "argon2id_64m"]) {
    for (const implementation of ["own", "altcha"]) {
      for (const concurrency of [1, 4, 8]) {
        const args = [
          binary,
          "--suite=matched",
          "--memory-profile",
          `${family}_l1`,
          "--implementation",
          implementation,
          "--concurrency",
          String(concurrency),
        ];
        const measured =
          platform() === "darwin"
            ? await command("/usr/bin/time", ["-l", ...args], true)
            : await command(binary, args.slice(1), true);
        const row = JSON.parse(measured.stdout);
        row.max_rss_bytes =
          Number(measured.stderr.match(/(\d+)\s+maximum resident set size/)?.[1]) || null;
        results.memory_probes.push(row);
        await save();
      }
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
