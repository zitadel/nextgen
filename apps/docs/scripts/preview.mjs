import { spawn } from "node:child_process";
import { join } from "node:path";

// waku picks its adapter from VERCEL at build time, and moon's `preview` task
// builds first with the caller's environment. A local preview needs the local
// adapter for both steps, so refuse rather than serve a mismatched build.
if (process.env.VERCEL) {
  console.error("docs preview: unset VERCEL to preview the local build (it selects the Vercel adapter)");
  process.exit(1);
}
const env = process.env;

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
