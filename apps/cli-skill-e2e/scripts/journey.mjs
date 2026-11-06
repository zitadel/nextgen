// Loads the journey definition (`journey.yaml`) for the tests and the report.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadJourney() {
  return parse(readFileSync(join(root, "journey.yaml"), "utf8"));
}
