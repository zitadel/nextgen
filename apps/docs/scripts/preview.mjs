import { spawn } from "node:child_process";
import { join } from "node:path";

const env = { ...process.env };
delete env.VERCEL;

// `node --run` and the local waku bin rather than `pnpm run`/`pnpm exec`: this
// helper already runs under `pnpm run preview`, and a nested pnpm warns about
// the platform-specific server packages.
const waku = join(import.meta.dirname, "..", "node_modules", ".bin", "waku");

await run("node", ["--run", "build"], { env });
await run(waku, ["start", "--port", env.PORT || "3003"], { env });

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}
