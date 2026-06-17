import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(docsRoot, "../..");
const input = resolve(repoRoot, "api/openapi/openapi-spec.yaml");
const output = resolve(docsRoot, ".generated/openapi.yaml");

await mkdir(dirname(output), { recursive: true });

await run("npx", [
  "--yes",
  "@redocly/cli@2.31.5",
  "bundle",
  input,
  "--output",
  output,
]);

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
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
