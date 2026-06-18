import { spawn } from "node:child_process";

const env = { ...process.env };
delete env.VERCEL;

await run("pnpm", ["run", "build"], { env });
await run("pnpm", ["exec", "waku", "start", "--port", env.PORT || "3003"], { env });

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
