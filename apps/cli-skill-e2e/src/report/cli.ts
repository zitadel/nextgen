import { join } from "node:path";

import { packageRoot } from "../paths.ts";
import { buildReport } from "./build.ts";

console.log("report:", buildReport(process.env.OUT ?? join(packageRoot, "out")));
