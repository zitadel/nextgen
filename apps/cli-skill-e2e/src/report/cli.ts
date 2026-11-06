import { join } from "node:path";

import { packageRoot } from "../paths.ts";
import { buildReport, journeysWithResults } from "./build.ts";

const outDir = process.env.OUT ?? join(packageRoot, "out");
for (const journey of journeysWithResults(outDir)) {
  console.log("report:", buildReport(outDir, journey));
}
