import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(docsRoot, "../..");
const input = resolve(repoRoot, "api/openapi/openapi-spec.yaml");
const outputDir = resolve(docsRoot, ".generated");
const yamlOutput = resolve(outputDir, "openapi.yaml");
const jsonOutput = resolve(outputDir, "openapi.json");
const moduleOutput = resolve(outputDir, "openapi.mjs");
// The pinned devDependency, run under this node: nothing is downloaded at
// build time.
const redocly = resolve(docsRoot, "node_modules", "@redocly", "cli", "bin", "cli.js");

await mkdir(dirname(yamlOutput), { recursive: true });

await run(process.execPath, [redocly, "bundle", input, "--output", yamlOutput]);

await run(process.execPath, [redocly, "bundle", input, "--output", jsonOutput]);

const bundledJson = await readFile(jsonOutput, "utf8");
await writeFile(moduleOutput, `export default ${bundledJson.trim()};\n`);

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      // Its telemetry runs `npm -v`, which warns about pnpm's config.
      env: { ...process.env, REDOCLY_TELEMETRY: "off" },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}
