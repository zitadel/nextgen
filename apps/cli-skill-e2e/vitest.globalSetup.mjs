// Runs once around the whole Vitest run: `setup` executes the eval (reuse-aware,
// so it's instant unless FRESH=1), `teardown` builds the HTML report and opens
// it in a browser window — regardless of whether the stage assertions passed.
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;
const OUT = process.env.OUT || join(here, "out");

export async function setup() {
  const r = spawnSync(node, [join(here, "scripts/run.mjs")], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) throw new Error(`eval run failed (exit ${r.status})`);
}

export async function teardown() {
  spawnSync(node, [join(here, "scripts/report.mjs")], { stdio: "inherit", env: process.env });
  const html = join(OUT, "journey.html");
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawnSync(opener, [html], { stdio: "ignore", shell: process.platform === "win32" });
  console.log("opened", html);
}
