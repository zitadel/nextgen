// zitadel-cli: managed-file v1
// Writes the project id into src/app/zitadel-project.ts, which .gitignore
// excludes, then runs the Angular CLI with the arguments it was given. The id
// comes from the environment, else from .env.local, which zitadel setup writes.
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const util = require("node:util");

function fromEnvLocal() {
  const file = join(__dirname, ".env.local");
  if (!existsSync(file)) return undefined;
  if (typeof util.parseEnv !== "function") {
    throw new Error("Reading .env.local needs Node.js 20.12 or newer; or set ZITADEL_PROJECT_ID in the environment.");
  }
  return util.parseEnv(readFileSync(file, "utf8")).ZITADEL_PROJECT_ID;
}

const projectId = process.env.ZITADEL_PROJECT_ID || fromEnvLocal();
if (!projectId) {
  throw new Error("ZITADEL_PROJECT_ID is not set: add it to .env.local (zitadel setup writes it) or to the environment.");
}
const path = join(__dirname, "src/app/zitadel-project.ts");
const contents = `// Written by zitadel-ng.cjs from ZITADEL_PROJECT_ID. Not committed.\nexport const ZITADEL_PROJECT_ID = ${JSON.stringify(projectId)};\n`;
if (!existsSync(path) || readFileSync(path, "utf8") !== contents) {
  writeFileSync(path, contents);
}
require("@angular/cli/bin/ng.js");
