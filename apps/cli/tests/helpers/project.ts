import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { onTestFinished } from "vitest";

import { parseJson, runCliForTest } from "./run-cli";

/**
 * A scaffolded app for the integration specs to drive the CLI against, so a
 * spec can read as the journey it describes rather than as the plumbing that
 * sets it up. Every method here runs the real built CLI against the mock
 * platform and returns what a developer could observe afterwards: the parsed
 * documents in `.zitadel`, the plan totals, the published credential names.
 *
 * Nothing in here knows about SSO specifically. Keep assertions in the spec;
 * keep paths, flag spellings and stdin plumbing in here.
 */

/** Where the mock platform answers. Not a real host; msw intercepts it. */
export const MOCK_SERVER_URL = "http://mock.zitadel.test";

/** What `plan` reports when the project and the platform already agree. */
export const NOTHING_TO_RECONCILE = {
  creates: 0,
  updates: 0,
  deletes: 0,
  revisions: 0,
};

export interface Credentials {
  readonly clientId: string;
  readonly secret: string;
}

export interface FlowStep {
  readonly name: string;
  readonly sso_providers?: string[];
  readonly transitions?: Record<string, unknown>;
}

interface PlanTotals {
  readonly creates: number;
  readonly updates: number;
  readonly deletes: number;
  readonly revisions: number;
}

interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The documents the CLI writes into the project, as a developer would read them. */
interface ProjectDocuments {
  readonly connection: Record<string, unknown>;
  readonly userSchema: Record<string, unknown>;
  readonly loginFlow: Record<string, unknown>;
}

export class ScaffoldedApp {
  constructor(readonly path: string) {}

  /**
   * Runs `setup` non-interactively, enabling the given providers. The client
   * secret is never a flag, so it is piped the way a script would pipe it.
   */
  async setupWithSso(provider: string, credentials: Credentials): Promise<CliResult> {
    return this.pipingSecret(credentials.secret, () =>
      this.cli([
        "setup",
        "--non-interactive",
        "--json",
        "--skip-install",
        "--framework",
        "next",
        "--sso",
        provider,
        "--sso-client-id",
        credentials.clientId,
      ]),
    );
  }

  /** Runs `sso enable` on an already-set-up project. */
  async enableSso(provider: string, credentials: Credentials): Promise<CliResult> {
    return this.pipingSecret(credentials.secret, () =>
      this.cli([
        "sso",
        "enable",
        "--non-interactive",
        "--json",
        "--provider",
        provider,
        "--client-id",
        credentials.clientId,
      ]),
    );
  }

  /** The totals `plan` reports, for comparison against `NOTHING_TO_RECONCILE`. */
  async plan(): Promise<PlanTotals> {
    const result = await this.cli(["plan", "--non-interactive", "--json"]);
    if (result.exitCode !== 0) {
      throw new Error(`plan exited ${result.exitCode}: ${result.stderr || result.stdout}`);
    }
    return (parseJson(result.stdout) as { data: PlanTotals }).data;
  }

  /** The committed connection file for a provider. */
  async idpConnection(slug: string): Promise<{ oidc: { client_id: string; client_secret: string } }> {
    return this.readDocument(`.zitadel/idps/${slug}.json`) as Promise<{
      oidc: { client_id: string; client_secret: string };
    }>;
  }

  /** The user schema, whose `x-auth-methods` says which methods are offered. */
  async userSchema(): Promise<{
    "x-auth-methods": { sso?: { enabled: boolean; providers: string[] } };
  }> {
    return this.readDocument(".zitadel/schemas/default-human-user.json") as Promise<{
      "x-auth-methods": { sso?: { enabled: boolean; providers: string[] } };
    }>;
  }

  /** The login flow definition. */
  async loginFlow(): Promise<{ steps: FlowStep[] }> {
    return this.readDocument(".zitadel/flows/default-login.json") as Promise<{ steps: FlowStep[] }>;
  }

  /**
   * The steps that actually offer a provider. The meta-schema defaults
   * `sso_providers` to `[]`, so presence of the key means nothing and only a
   * non-empty list is a step a sign-in can start from.
   */
  async stepsOfferingSso(): Promise<FlowStep[]> {
    const { steps } = await this.loginFlow();
    return steps.filter((step) => (step.sso_providers ?? []).length > 0);
  }

  /** Every document the CLI wrote, as one string, to assert a value is absent. */
  async writtenConfig(slug: string): Promise<string> {
    const documents = await this.documents(slug);
    return JSON.stringify(documents);
  }

  /** All three documents, to compare a rerun against an earlier run. */
  async documents(slug: string): Promise<ProjectDocuments> {
    const [connection, userSchema, loginFlow] = await Promise.all([
      this.readDocument(`.zitadel/idps/${slug}.json`),
      this.readDocument(".zitadel/schemas/default-human-user.json"),
      this.readDocument(".zitadel/flows/default-login.json"),
    ]);
    return { connection, userSchema, loginFlow };
  }

  private async readDocument(relativePath: string): Promise<Record<string, unknown>> {
    const contents = await readFile(join(this.path, relativePath), "utf8");
    return JSON.parse(contents) as Record<string, unknown>;
  }

  private cli(args: string[]): Promise<CliResult> {
    return runCliForTest([...args, "--cwd", this.path, "--server", MOCK_SERVER_URL]);
  }

  /**
   * `runCliForTest` runs in-process, so a scripted run would otherwise read the
   * test runner's own stdin and block on a stream that never ends.
   */
  private async pipingSecret<T>(secret: string, run: () => Promise<T>): Promise<T> {
    const original = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", {
      value: Readable.from([secret]),
      configurable: true,
    });
    try {
      return await run();
    } finally {
      if (original) {
        Object.defineProperty(process, "stdin", original);
      }
    }
  }
}

/**
 * A minimal Next app in a temp directory — the posture `setup` scaffolds into.
 * Removes itself when the test finishes, so a spec carries no teardown.
 */
export async function aNextApp(): Promise<ScaffoldedApp> {
  const path = await mkdtemp(join(tmpdir(), "zitadel-app-"));
  onTestFinished(() => rm(path, { recursive: true, force: true }));

  await mkdir(join(path, "app"), { recursive: true });
  await writeFile(
    join(path, "package.json"),
    JSON.stringify(
      {
        name: "demo-next-app",
        private: true,
        dependencies: { next: "^16.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      null,
      2,
    ),
  );
  await writeFile(join(path, ".gitignore"), "node_modules\n");
  await writeFile(
    join(path, "app/layout.tsx"),
    "export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n",
  );
  return new ScaffoldedApp(path);
}
