import { stat } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "../lib/errors";
import { hasDependency, readPackageJson } from "./package-json";

export type FrameworkId = "next";

export type FrameworkDetection = {
  id: FrameworkId;
  appDir: "app" | "src/app";
};

export async function detectFramework(cwd: string, requested?: string): Promise<FrameworkDetection> {
  if (requested && requested !== "next") {
    throw new ZitadelError("E_FRAMEWORK_NOT_DETECTED", `Unsupported framework "${requested}"`, {
      hint: "V1 supports Next.js App Router projects only.",
    });
  }

  const pkg = await readPackageJson(cwd).catch(() => undefined);
  if (!pkg || !hasDependency(pkg, "next")) {
    throw new ZitadelError("E_FRAMEWORK_NOT_DETECTED", "Could not detect a Next.js project", {
      hint: "Run this from a Next.js App Router project or pass --cwd <path>.",
    });
  }

  const appDir = (await dirExists(join(cwd, "app"))) ? "app" : (await dirExists(join(cwd, "src/app"))) ? "src/app" : undefined;
  if (!appDir) {
    throw new ZitadelError("E_UNSUPPORTED_PROJECT_SHAPE", "Next.js Pages Router projects are not supported in v1", {
      hint: "Create an App Router project with an app/ or src/app/ directory.",
    });
  }

  return { id: "next", appDir };
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
