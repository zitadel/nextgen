import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(here, "../../..");
const defaultRegistryUrl = "http://127.0.0.1:4873";
const defaultAppUrl = "http://localhost:3000";

export async function prepareNextApp(options = {}) {
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const outputDir = resolve(
    env.JOURNEY_WORK_DIR ?? join(tmpdir(), `zitadel-cli-journey-${process.pid}-${Date.now()}`),
  );
  const appDir = resolve(env.JOURNEY_APP_DIR ?? join(outputDir, "myapp"));
  const registryUrl = env.JOURNEY_REGISTRY_URL ?? defaultRegistryUrl;
  const appUrl = env.JOURNEY_APP_URL ?? defaultAppUrl;
  const fs = {
    appendFile: options.appendFile ?? appendFile,
    mkdir: options.mkdir ?? mkdir,
    readFile: options.readFile ?? readFile,
    rm: options.rm ?? rm,
    writeFile: options.writeFile ?? writeFile,
  };
  const runCaptureFn = options.runCapture ?? runCapture;
  const packageNameFn =
    options.packageName ?? ((relativePath) => packageName(relativePath, { readFile: fs.readFile, repoRoot }));
  const cliPackage = env.JOURNEY_CLI_PACKAGE ?? (await packageNameFn("apps/cli"));
  const sdkNextPackage = env.JOURNEY_SDK_NEXT_PACKAGE ?? (await packageNameFn("packages/sdk-next"));
  const npmEnv = npmEnvironment(env, registryUrl);

  await fs.rm(appDir, { recursive: true, force: true });
  await fs.mkdir(appDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  let startJson;
  let setupJson;
  try {
    await runCliJsonStep({
      appDir,
      cliPackage,
      env: npmEnv,
      outputDir,
      runCapture: runCaptureFn,
      step: "doctor",
      stepArgs: ["doctor"],
      writeFile: fs.writeFile,
    });
    startJson = await runCliJsonStep({
      appDir,
      cliPackage,
      env: npmEnv,
      outputDir,
      runCapture: runCaptureFn,
      step: "start",
      stepArgs: ["start"],
      writeFile: fs.writeFile,
    });
    setupJson = await runCliJsonStep({
      appDir,
      cliPackage,
      env: npmEnv,
      outputDir,
      runCapture: runCaptureFn,
      step: "setup",
      stepArgs: ["setup", "--framework", "next", "--server", "local"],
      writeFile: fs.writeFile,
    });
  } catch (error) {
    await collectLocalRuntimeLogs({
      appDir,
      cliPackage,
      env: npmEnv,
      outputDir,
      runCapture: runCaptureFn,
      writeFile: fs.writeFile,
    });
    throw error;
  }

  await assertNoNestedApp(appDir, fs.readFile);

  const appPackage = JSON.parse(await fs.readFile(join(appDir, "package.json"), "utf8"));
  const dependencies = {
    ...(appPackage.dependencies ?? {}),
    ...(appPackage.devDependencies ?? {}),
  };
  if (!dependencies[sdkNextPackage]) {
    throw new Error(`generated package.json does not depend on ${sdkNextPackage}`);
  }

  const packageLockPath = join(appDir, "package-lock.json");
  const packageLock = JSON.parse(await fs.readFile(packageLockPath, "utf8"));
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
    appUrl,
    cliPackage,
    doctorPath: join(outputDir, "doctor.json"),
    localRuntimeUrl: startJson?.data?.urls?.api ?? null,
    outputDir,
    registryUrl,
    runtimeMetadataPath: join(appDir, ".zitadel/local/runtime.json"),
    sdkNextPackage,
    setupPath: join(outputDir, "setup.json"),
    setupServer: setupJson?.data?.server ?? null,
    startPath: join(outputDir, "start.json"),
  };
  const metadataPath = join(outputDir, "metadata.json");
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  await exportEnv("JOURNEY_APP_DIR", appDir, fs.appendFile, env);
  await exportEnv("JOURNEY_APP_URL", appUrl, fs.appendFile, env);
  await exportEnv("JOURNEY_OUTPUT_DIR", outputDir, fs.appendFile, env);
  await exportOutput("app_dir", appDir, fs.appendFile, env);
  await exportOutput("output_dir", outputDir, fs.appendFile, env);

  if (options.logMetadata !== false) {
    console.log(JSON.stringify(metadata, null, 2));
  }
  return metadata;
}

export function cliStepArgs(cliPackage, stepArgs) {
  return ["--yes", `${cliPackage}@alpha`, ...stepArgs, "--non-interactive", "--json"];
}

async function runCliJsonStep(input) {
  const result = await input.runCapture("npx", cliStepArgs(input.cliPackage, input.stepArgs), {
    cwd: input.appDir,
    env: input.env,
  });
  await input.writeFile(join(input.outputDir, `${input.step}.json`), result.stdout);
  await input.writeFile(join(input.outputDir, `${input.step}.stderr.log`), result.stderr);

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${input.step} stdout was not JSON: ${String(error)}\n${result.stdout}`, {
      cause: error,
    });
  }

  if (result.code !== 0) {
    throw new Error(`${input.step} exited ${result.code}: ${parsed.message ?? result.stderr}`);
  }
  if (parsed.status !== "ok") {
    throw new Error(`${input.step} returned status ${JSON.stringify(parsed.status)}`);
  }
  return parsed;
}

async function collectLocalRuntimeLogs(input) {
  let result;
  try {
    result = await input.runCapture(
      "npx",
      cliStepArgs(input.cliPackage, ["logs", "--tail", "400"]),
      { cwd: input.appDir, env: input.env },
    );
  } catch (error) {
    await input.writeFile(
      join(input.outputDir, "logs.stderr.log"),
      `failed to collect local runtime logs: ${errorMessage(error)}\n`,
    );
    return;
  }
  await input.writeFile(join(input.outputDir, "logs.json"), result.stdout);
  await input.writeFile(join(input.outputDir, "logs.stderr.log"), result.stderr);
}

async function assertNoNestedApp(appDir, readFileFn) {
  try {
    await readFileFn(join(appDir, "myapp", "package.json"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error("setup scaffolded a nested myapp directory instead of using the app root");
}

async function packageName(relativePath, options) {
  const pkg = JSON.parse(
    await options.readFile(join(options.repoRoot, relativePath, "package.json"), "utf8"),
  );
  if (typeof pkg.name !== "string" || pkg.name.length === 0) {
    throw new Error(`${relativePath}/package.json has no name`);
  }
  return pkg.name;
}

function npmEnvironment(env, registryUrl) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.startsWith("npm_config_")) {
      delete next[key];
    }
  }
  return {
    ...next,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_registry: registryUrl,
    npm_config_yes: "true",
  };
}

function runCapture(command, args, options) {
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
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function exportEnv(name, value, appendFileFn, env) {
  if (!env.GITHUB_ENV) return;
  await appendFileFn(env.GITHUB_ENV, `${name}=${value}\n`);
}

async function exportOutput(name, value, appendFileFn, env) {
  if (!env.GITHUB_OUTPUT) return;
  await appendFileFn(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await prepareNextApp();
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
