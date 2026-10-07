import { spawn } from "node:child_process";
import { join } from "node:path";

// Without VERCEL, waku serves the local build instead of expecting Vercel's.
const env = { ...process.env };
delete env.VERCEL;

// moon's `preview` task builds first. waku's CLI runs under node rather than
// through `pnpm exec` (this helper already runs under `pnpm run preview`, and a
// nested pnpm warns about the platform-specific server packages) or its `.bin`
// shim (a `.cmd` on Windows, which spawn cannot start without a shell).
const wakuCli = join(import.meta.dirname, "..", "node_modules", "waku", "cli.js");

await run(process.execPath, [wakuCli, "start", "--port", env.PORT || "3003"], { env });

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
