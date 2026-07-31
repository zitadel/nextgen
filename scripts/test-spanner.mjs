#!/usr/bin/env node
/**
 * Run Spanner integration tests. When ZITADEL_TEST_SPANNER_INSTANCE is unset,
 * force -parallel 1 -p 1 so the single-transaction emulator stays reliable for
 * local/OSS and unconfigured CI. With a real instance configured, keep normal
 * go test parallelism.
 */
import { run } from "./dev-process.mjs";

const args = [
  "test",
  "-v",
  "-tags",
  "spanner_integration",
  "-timeout",
  "10m",
];

if (!process.env.ZITADEL_TEST_SPANNER_INSTANCE?.trim()) {
  args.push("-parallel", "1", "-p", "1");
}

args.push("./...");

try {
  await run("go", args);
} catch (error) {
  process.exit(typeof error?.code === "number" ? error.code : 1);
}
