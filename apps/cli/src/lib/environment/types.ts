import type { Questions } from "@/lib/ui";
import type { Suggest } from "@/lib/suggestion";
import type { ZitadelClient } from "@/lib/backend";

import type { ENVIRONMENT_KEYS } from "./keys";

/** One value an environment holds, by name. */
export type EnvironmentKey = (typeof ENVIRONMENT_KEYS)[number];

/** The values found in one source, by name. */
export type Values = Partial<Record<EnvironmentKey, string>>;

/** One resolved value and where it came from. */
export type Resolved = Readonly<{ value: string; source: string }>;

/** One place the chain looked, and which keys it supplied. */
export type Consulted = Readonly<{
  source: string;
  /** Whether the flag was given, or the file exists. */
  present: boolean;
  /** The keys this source supplied that no earlier source had. */
  supplied: readonly EnvironmentKey[];
}>;

/** What {@link Environment.resolve} reads. */
export type ResolveEnvironmentInput = Readonly<{
  cwd: string;
  env: NodeJS.ProcessEnv;
  serverFlag?: string;
  envName?: string;
  envFile?: string;
}>;

/** What {@link Environment.requireInteractive} asks with, and whether it may. */
export type InteractiveOptions = {
  cwd: string;
  interactive: boolean;
  ask: Questions;
};

/** One `.env.<name>.local` file that binds an environment to a project. */
export type BoundEnvironment = { name: string; file: string; values: Values };

/** What the first deploy of a project published. */
export type InitialDeployment = {
  readonly releaseId: string;
  readonly contentHash: string;
  readonly deploymentId: string;
  readonly origins: readonly string[];
};

/** What {@link Environment.deployInitialRelease} publishes, to whom, and how it reports. */
export type InitialReleaseInput = {
  client: ZitadelClient;
  projectId: string;
  cwd: string;
  env: Record<string, string | undefined>;
  json: boolean;
  color: boolean;
  message: string;
  suggest: Suggest;
  narrate: (notices: readonly string[]) => void;
};
