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
const playwrightModule = await import(pathToFileURL(require.resolve("playwright")));
const playwright = playwrightModule.default || playwrightModule;
const out = join(here, "dist");
const testOnly = process.argv.includes("--test");
const browsersOnly = process.argv.includes("--browsers-only");
const samples = Number(process.env.POW_BENCH_SAMPLES || 32);
async function command(cmd, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: here, stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}
await mkdir(out, { recursive: true });
await command("go", ["test", "-count=1", "./..."]);
if (testOnly) {
  await command("go", ["vet", "./..."]);
  await command("go", ["test", "-run=^$", "-fuzz=FuzzStrictProof", "-fuzztime=5s", "-parallel=2"]);
  await command("go", [
    "test",
    "-run=^$",
    "-fuzz=FuzzMatchedProofDecoder",
    "-fuzztime=5s",
    "-parallel=2",
  ]);
}
if (!browsersOnly) {
  await command("go", ["build", "-o", join(out, "pow-bench"), "."]);
  if (!testOnly)
    await command(join(out, "pow-bench"), ["--samples", String(samples), "--out", out]);
}
await build({
  entryPoints: [join(here, "worker.mjs")],
  bundle: true,
  outfile: join(out, "worker.js"),
  platform: "browser",
  format: "iife",
  minify: true,
  nodePaths: process.env.POW_BENCH_NODE_MODULES ? [process.env.POW_BENCH_NODE_MODULES] : [],
});
const worker = await readFile(join(out, "worker.js"));
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; worker-src 'self'",
  );
  res.setHeader("Content-Type", req.url === "/worker.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/worker.js" ? worker : "<!doctype html><title>PoW benchmark</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const corpus = testOnly ? null : JSON.parse(await readFile(join(out, "corpus.json"), "utf8"));
const altchaVector = JSON.parse(await readFile(join(here, "testdata/altcha-vector.json"), "utf8"));
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
  },
  browsers: [],
};
const proofs = [];
try {
  for (const name of (process.env.POW_BENCH_BROWSERS || "chromium,firefox,webkit").split(",")) {
    const browser = await playwright[name].launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url);
      const result = { name, version: browser.version(), groups: [] };
      const checks = await page.evaluate(async (altchaVector) => {
        const start = performance.now();
        const worker = new Worker("/worker.js");
        await new Promise((resolve, reject) => {
          worker.onmessage = resolve;
          worker.onerror = reject;
        });
        const startup_ms = performance.now() - start;
        const vector = new Promise((resolve, reject) => {
          worker.onmessage = (event) => resolve(event.data);
          worker.onerror = reject;
        });
        worker.postMessage({ vector: true });
        const { digest } = await vector;
        const keyVector = new Promise((resolve, reject) => {
          worker.onmessage = (event) => resolve(event.data);
          worker.onerror = reject;
        });
        worker.postMessage({ altcha_vector: altchaVector });
        const { derived_key, error } = await keyVector;
        if (error || derived_key !== altchaVector.derived_key)
          throw new Error("ALTCHA vector mismatch");
        // A deliberately long solve remains off the main thread and can be terminated.
        worker.postMessage({
          candidate: { own: true },
          challenge: { ticket: "cancellation-fixture", difficulty_bits: 32 },
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        const cancelStart = performance.now();
        worker.terminate();
        return {
          startup_ms,
          terminate_call_ms: performance.now() - cancelStart,
          digest,
          derived_key,
        };
      }, altchaVector);
      result.checks = checks;
      // Filled with the Go-pinned digest after generating the initial fixture.
      if (checks.digest !== "569acc01eb9b3c62c9f0bec110995475086a75a39b256ca360b562318f03dabb")
        throw new Error(`Vector mismatch: ${checks.digest}`);
      if (!testOnly) {
        for (const group of corpus.groups) {
          const variants = group.candidate.cost === 1 ? ["noble", "webcrypto"] : ["default"];
          for (const variant of variants) {
            // Stock WebCrypto SHA at 20 bits would measure asynchronous dispatch overhead
            // for minutes; compare the identical 16-bit puzzles for that adapter instead.
            if (variant === "webcrypto" && group.candidate.bits > 16) continue;
            const selected = variant === "webcrypto" ? group.samples.slice(0, 8) : group.samples;
            const rows = await page.evaluate(
              async ({ candidate, samples, variant }) => {
                const worker = new Worker("/worker.js");
                await new Promise((resolve, reject) => {
                  worker.onmessage = resolve;
                  worker.onerror = reject;
                });
                const solve = (challenge) =>
                  new Promise((resolve, reject) => {
                    worker.onmessage = ({ data }) =>
                      data.error ? reject(new Error(data.error)) : resolve(data);
                    worker.onerror = reject;
                    worker.postMessage({ candidate, challenge, variant });
                  });
                let last = performance.now();
                let maxGap = 0;
                const heartbeat = setInterval(() => {
                  const now = performance.now();
                  maxGap = Math.max(maxGap, now - last);
                  last = now;
                }, 10);
                try {
                  await solve(samples[0].challenge); // Warm-up excluded from samples.
                  const rows = [];
                  for (const [index, sample] of samples.entries()) {
                    const wall = performance.now();
                    const result = await solve(sample.challenge);
                    rows.push({ index, ...result, wall_ms: performance.now() - wall });
                  }
                  return { rows, main_thread_max_interval_ms: maxGap };
                } finally {
                  clearInterval(heartbeat);
                  worker.terminate();
                }
              },
              { candidate: group.candidate, samples: selected, variant },
            );
            result.groups.push({ candidate: group.candidate.name, variant, ...rows });
            for (const row of rows.rows)
              proofs.push({ candidate: group.candidate.name, index: row.index, proof: row.proof });
            process.stdout.write(
              `${name}: ${group.candidate.name}/${variant} (${selected.length})\n`,
            );
          }
        }
      }
      results.browsers.push(result);
      await writeFile(
        join(out, testOnly ? "browser-checks.json" : "browser-results.json"),
        `${JSON.stringify(results, null, 2)}\n`,
      );
      if (!testOnly)
        await writeFile(join(out, "browser-proofs.json"), `${JSON.stringify(proofs, null, 2)}\n`);
    } finally {
      await browser.close();
    }
  }
  if (!testOnly)
    await command(join(out, "pow-bench"), [
      "--out",
      out,
      "--verify",
      join(out, "browser-proofs.json"),
    ]);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
