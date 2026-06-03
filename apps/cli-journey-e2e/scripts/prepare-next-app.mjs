import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const registryUrl = process.env.JOURNEY_REGISTRY_URL ?? "http://127.0.0.1:4873";
const backendUrl = process.env.JOURNEY_BACKEND_URL ?? "http://localhost:8080";
const createNextAppVersion = process.env.JOURNEY_CREATE_NEXT_APP_VERSION ?? "16.2.4";
const outputDir =
  process.env.JOURNEY_WORK_DIR ??
  join(tmpdir(), `zitadel-cli-journey-${process.pid}-${Date.now()}`);
const appDir = join(outputDir, "myapp");
const cliPackage = process.env.JOURNEY_CLI_PACKAGE ?? (await packageName("apps/cli"));
const sdkNextPackage =
  process.env.JOURNEY_SDK_NEXT_PACKAGE ?? (await packageName("packages/sdk-next"));

await rm(appDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const npmEnv = {
  ...process.env,
  npm_config_registry: registryUrl,
  npm_config_yes: "true",
};

await run(
  "npx",
  [
    "--yes",
    `create-next-app@${createNextAppVersion}`,
    "myapp",
    "--ts",
    "--app",
    "--no-git",
    "--yes",
  ],
  { cwd: outputDir, env: npmEnv },
);

const setup = await run(
  "npx",
  [
    "--yes",
    `${cliPackage}@alpha`,
    "setup",
    "--framework",
    "next",
    "--server",
    backendUrl,
    "--non-interactive",
    "--json",
  ],
  { cwd: appDir, env: npmEnv },
);

const setupPath = join(outputDir, "setup.json");
const setupStderrPath = join(outputDir, "setup.stderr.log");
await writeFile(setupPath, setup.stdout);
await writeFile(setupStderrPath, setup.stderr);

let setupJson;
try {
  setupJson = JSON.parse(setup.stdout);
} catch (error) {
  throw new Error(`setup stdout was not JSON: ${String(error)}\n${setup.stdout}`, {
    cause: error,
  });
}
if (setupJson.status !== "ok") {
  throw new Error(`setup returned status ${JSON.stringify(setupJson.status)}`);
}

const appPackage = JSON.parse(await readFile(join(appDir, "package.json"), "utf8"));
const dependencies = {
  ...(appPackage.dependencies ?? {}),
  ...(appPackage.devDependencies ?? {}),
};
if (!dependencies[sdkNextPackage]) {
  throw new Error(`generated package.json does not depend on ${sdkNextPackage}`);
}

await run("npm", ["install", "--registry", registryUrl], { cwd: appDir, env: npmEnv });

const packageLockPath = join(appDir, "package-lock.json");
const packageLock = JSON.parse(await readFile(packageLockPath, "utf8"));
const packageScope = sdkNextPackage.split("/")[0];
const scopedNodeModulePrefix = `node_modules/${packageScope}/`;
const lockedZitadelPackages = Object.entries(packageLock.packages ?? {}).filter(
  ([name]) => name.startsWith(scopedNodeModulePrefix),
);
if (lockedZitadelPackages.length === 0) {
  throw new Error(`package-lock.json does not contain ${packageScope} packages`);
}
for (const [name, entry] of lockedZitadelPackages) {
  const resolved = entry?.resolved;
  if (typeof resolved !== "string" || !resolved.startsWith(registryUrl)) {
    throw new Error(`${name} resolved outside the temporary registry: ${resolved}`);
  }
}

const metadata = {
  appDir,
  backendUrl,
  cliPackage,
  createNextAppVersion,
  outputDir,
  registryUrl,
  sdkNextPackage,
  setupPath,
};
const metadataPath = join(outputDir, "metadata.json");
await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

await exportEnv("JOURNEY_APP_DIR", appDir);
await exportEnv("JOURNEY_APP_URL", "http://127.0.0.1:3000");
await exportEnv("JOURNEY_OUTPUT_DIR", outputDir);
await exportOutput("app_dir", appDir);
await exportOutput("output_dir", outputDir);

console.log(JSON.stringify(metadata, null, 2));

async function packageName(relativePath) {
  const pkg = JSON.parse(
    await readFile(join(repoRoot, relativePath, "package.json"), "utf8"),
  );
  if (typeof pkg.name !== "string" || pkg.name.length === 0) {
    throw new Error(`${relativePath}/package.json has no name`);
  }
  return pkg.name;
}

function run(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} exited ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
        ),
      );
    });
  });
}

async function exportEnv(name, value) {
  if (!process.env.GITHUB_ENV) return;
  await appendFile(process.env.GITHUB_ENV, `${name}=${value}\n`);
}

async function exportOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
