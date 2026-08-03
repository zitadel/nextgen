import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { appPortFromUrl, frameworkForId } from "./frameworks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(here, "../../..");
const defaultRegistryUrl = "http://127.0.0.1:4873";
const defaultAppUrl = "http://localhost:3000";

export async function prepareApp(options = {}) {
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const framework = frameworkForId(options.framework ?? env.JOURNEY_FRAMEWORK ?? "next");
  const outputDir = resolve(
    env.JOURNEY_WORK_DIR ??
      join(tmpdir(), `zitadel-cli-journey-${framework.id}-${process.pid}-${Date.now()}`),
  );
  const appDir = resolve(env.JOURNEY_APP_DIR ?? join(outputDir, "myapp"));
  const registryUrl = env.JOURNEY_REGISTRY_URL ?? defaultRegistryUrl;
  const appUrl = env.JOURNEY_APP_URL ?? defaultAppUrl;
  const appPort = appPortFromUrl(appUrl);
  const zitadelPort = optionalPort(env.JOURNEY_ZITADEL_PORT, "JOURNEY_ZITADEL_PORT");
  const runtime = localRuntime(env.JOURNEY_RUNTIME);
  const preset = options.preset ?? env.JOURNEY_PRESET ?? "";
  const fs = {
    appendFile: options.appendFile ?? appendFile,
    mkdir: options.mkdir ?? mkdir,
    readFile: options.readFile ?? readFile,
    rm: options.rm ?? rm,
    writeFile: options.writeFile ?? writeFile,
  };
  const runCaptureFn = options.runCapture ?? runCapture;
  const packageNameFn =
    options.packageName ??
    ((relativePath) => packageName(relativePath, { readFile: fs.readFile, repoRoot }));
  const cliPackage = env.JOURNEY_CLI_PACKAGE ?? (await packageNameFn("apps/cli"));
  const sdkPackage =
    env.JOURNEY_SDK_PACKAGE ??
    env[`JOURNEY_SDK_${framework.id.toUpperCase()}_PACKAGE`] ??
    (await packageNameFn(framework.sdkPackageDir));
  const npmEnv = npmEnvironment(env, registryUrl, outputDir);

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
      stepArgs: withRuntime(withPort(["doctor"], zitadelPort), runtime),
      writeFile: fs.writeFile,
    });
    startJson = await runCliJsonStep({
      appDir,
      cliPackage,
      env: npmEnv,
      outputDir,
      runCapture: runCaptureFn,
      step: "start",
      stepArgs: withRuntime(withPort(["start"], zitadelPort), runtime),
      writeFile: fs.writeFile,
    });
    setupJson = await runCliJsonStep({
      appDir,
      cliPackage,
      env: npmEnv,
      outputDir,
      runCapture: runCaptureFn,
      step: "setup",
      stepArgs: [
        "setup",
        "--framework",
        framework.id,
        "--server",
        "local",
        "--dev-port",
        String(appPort),
        ...(preset ? ["--preset", preset] : []),
      ],
      writeFile: fs.writeFile,
    });
    if (framework.id === "next") {
      await runManagedFileDriftProbe({
        appDir,
        cliPackage,
        env: npmEnv,
        fs,
        outputDir,
        runCapture: runCaptureFn,
        stepArgsFor: (base) => withRuntime(withPort(base, zitadelPort), runtime),
      });
    }
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
  await assertLocalPackageResolution({
    appDir,
    readFile: fs.readFile,
    registryUrl,
    sdkPackage,
  });

  const metadata = {
    appDir,
    appUrl,
    cliPackage,
    doctorPath: join(outputDir, "doctor.json"),
    framework: framework.id,
    frameworkDisplayName: framework.displayName,
    localRuntimeUrl: startJson?.data?.urls?.api ?? null,
    preset: preset || null,
    runtime,
    outputDir,
    registryUrl,
    runtimeMetadataPath: join(appDir, ".zitadel/local/runtime.json"),
    sdkPackage,
    setupPath: join(outputDir, "setup.json"),
    setupServer: setupJson?.data?.server ?? null,
    startPath: join(outputDir, "start.json"),
    expectsProtectedRouteRedirect: framework.expectsProtectedRouteRedirect,
  };
  const metadataPath = join(outputDir, "metadata.json");
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  await exportEnv("JOURNEY_APP_DIR", appDir, fs.appendFile, env);
  await exportEnv("JOURNEY_APP_URL", appUrl, fs.appendFile, env);
  await exportEnv("JOURNEY_FRAMEWORK", framework.id, fs.appendFile, env);
  if (preset) {
    await exportEnv("JOURNEY_PRESET", preset, fs.appendFile, env);
  }
  await exportEnv("JOURNEY_OUTPUT_DIR", outputDir, fs.appendFile, env);
  await exportOutput("app_dir", appDir, fs.appendFile, env);
  await exportOutput("framework", framework.id, fs.appendFile, env);
  await exportOutput("output_dir", outputDir, fs.appendFile, env);

  if (options.logMetadata !== false) {
    console.log(JSON.stringify(metadata, null, 2));
  }
  return metadata;
}

export function cliStepArgs(cliPackage, stepArgs, cwd) {
  const cwdArgs = cwd ? ["--cwd", cwd] : [];
  return ["--yes", `${cliPackage}@alpha`, ...stepArgs, ...cwdArgs, "--non-interactive", "--json"];
}

async function runCliJsonStep(input) {
  const result = await input.runCapture(
    "npx",
    cliStepArgs(input.cliPackage, input.stepArgs, input.appDir),
    {
      cwd: input.appDir,
      env: input.env,
    },
  );
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

  if (input.expectFailure) {
    if (result.code === 0 || parsed.status === "ok") {
      throw new Error(
        `${input.step} was expected to fail but returned status ` +
          `${JSON.stringify(parsed.status)} (exit ${result.code})`,
      );
    }
    return parsed;
  }
  if (result.code !== 0) {
    throw new Error(`${input.step} exited ${result.code}: ${parsed.message ?? result.stderr}`);
  }
  if (parsed.status !== "ok") {
    throw new Error(`${input.step} returned status ${JSON.stringify(parsed.status)}`);
  }
  return parsed;
}

/**
 * Journey-level proof of the doctor managed-files contract on the freshly
 * generated app: deleting the scaffolded request boundary must fail
 * `doctor`, and `doctor --fix` must restore the file and pass. Runs on the
 * Next suite only — the contract is framework-neutral and unit-covered in
 * apps/cli; one framework proves the published consumer path end to end
 * without slowing every suite. Writes `doctor-drift.json` and
 * `doctor-fix.json` artifacts that `contract.spec.ts` asserts on.
 */
async function runManagedFileDriftProbe(input) {
  const boundary = await firstExistingFile(
    input.appDir,
    ["proxy.ts", "middleware.ts"],
    input.fs.readFile,
  );
  await input.fs.rm(join(input.appDir, boundary));
  await runCliJsonStep({
    appDir: input.appDir,
    cliPackage: input.cliPackage,
    env: input.env,
    expectFailure: true,
    outputDir: input.outputDir,
    runCapture: input.runCapture,
    step: "doctor-drift",
    stepArgs: input.stepArgsFor(["doctor"]),
    writeFile: input.fs.writeFile,
  });
  await runCliJsonStep({
    appDir: input.appDir,
    cliPackage: input.cliPackage,
    env: input.env,
    outputDir: input.outputDir,
    runCapture: input.runCapture,
    step: "doctor-fix",
    stepArgs: input.stepArgsFor(["doctor", "--fix"]),
    writeFile: input.fs.writeFile,
  });
  const restored = await input.fs.readFile(join(input.appDir, boundary), "utf8");
  if (!restored.includes("zitadel-cli: managed-file")) {
    throw new Error(`doctor --fix did not restore the managed ${boundary}`);
  }
}

async function firstExistingFile(dir, candidates, readFileFn) {
  for (const candidate of candidates) {
    try {
      await readFileFn(join(dir, candidate), "utf8");
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`none of ${candidates.join(", ")} exists in ${dir}`);
}

async function collectLocalRuntimeLogs(input) {
  let result;
  try {
    result = await input.runCapture(
      "npx",
      cliStepArgs(input.cliPackage, ["logs", "--tail", "400"], input.appDir),
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

async function assertLocalPackageResolution(input) {
  const appPackage = JSON.parse(await input.readFile(join(input.appDir, "package.json"), "utf8"));
  const dependencies = {
    ...(appPackage.dependencies ?? {}),
    ...(appPackage.devDependencies ?? {}),
  };
  if (!dependencies[input.sdkPackage]) {
    throw new Error(`generated package.json does not depend on ${input.sdkPackage}`);
  }

  const packageLockText = await readOptionalFile(
    join(input.appDir, "package-lock.json"),
    input.readFile,
  );
  if (packageLockText) {
    assertNpmLockfileResolution({
      lockfile: JSON.parse(packageLockText),
      registryUrl: input.registryUrl,
      sdkPackage: input.sdkPackage,
    });
    return;
  }

  const pnpmLockText = await readOptionalFile(
    join(input.appDir, "pnpm-lock.yaml"),
    input.readFile,
  );
  if (pnpmLockText) {
    assertPnpmLockfileResolution({
      lockfile: pnpmLockText,
      registryUrl: input.registryUrl,
      sdkPackage: input.sdkPackage,
    });
    return;
  }

  throw new Error("generated app has no supported lockfile (package-lock.json or pnpm-lock.yaml)");
}

function assertNpmLockfileResolution(input) {
  const packageScope = input.sdkPackage.split("/")[0];
  const scopedNodeModulePrefix = `node_modules/${packageScope}/`;
  const lockedZitadelPackages = Object.entries(input.lockfile.packages ?? {}).filter(([name]) =>
    name.startsWith(scopedNodeModulePrefix),
  );
  if (lockedZitadelPackages.length === 0) {
    throw new Error(`package-lock.json does not contain ${packageScope} packages`);
  }
  for (const [name, entry] of lockedZitadelPackages) {
    const resolved = entry?.resolved;
    if (typeof resolved !== "string" || !resolved.startsWith(input.registryUrl)) {
      throw new Error(`${name} resolved outside the temporary registry: ${resolved}`);
    }
  }
}

function assertPnpmLockfileResolution(input) {
  if (!input.lockfile.includes(input.sdkPackage)) {
    throw new Error(`pnpm-lock.yaml does not contain ${input.sdkPackage}`);
  }
  if (!input.lockfile.includes(input.registryUrl)) {
    throw new Error(`pnpm-lock.yaml does not contain the temporary registry ${input.registryUrl}`);
  }
}

async function readOptionalFile(path, readFileFn) {
  try {
    return await readFileFn(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
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

function npmEnvironment(env, registryUrl, outputDir) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.startsWith("npm_config_")) {
      delete next[key];
    }
  }
  return {
    ...next,
    npm_config_audit: "false",
    npm_config_cache: join(outputDir, ".npm-cache"),
    npm_config_fund: "false",
    npm_config_prefer_online: "true",
    npm_config_registry: registryUrl,
    npm_config_tmp: join(outputDir, ".npm-tmp"),
    npm_config_yes: "true",
  };
}

function optionalPort(value, name) {
  if (!value) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${name} must be a TCP port, got ${value}`);
  }
  return port;
}

function withPort(args, port) {
  if (!port) return args;
  return [...args, "--port", String(port)];
}

function withRuntime(args, runtime) {
  return [...args, "--runtime", runtime];
}

function localRuntime(value) {
  if (value === undefined || value === "") {
    return "binary";
  }
  if (value === "binary" || value === "docker") {
    return value;
  }
  throw new Error(`JOURNEY_RUNTIME must be binary or docker, got ${value}`);
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
    await prepareApp();
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
