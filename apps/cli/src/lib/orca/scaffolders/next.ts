import { AbstractCLIScaffolder } from "./cli";
import type { NodeEngines } from "./node-engines";

/**
 * The `create-next-app` release setup runs, pinned exactly so a fresh app is
 * the one the patcher was written against. `create-next-app` writes `next` at
 * its own version, so this is also the Next.js every fresh app runs, until its
 * developer upgrades it. Its route protection is `nextgenMiddleware`, which
 * runs in Next's Middleware / Proxy, and 16.2.x had several bypasses of that
 * layer: keep the pin on a release with no high or critical advisory, as
 * `cli:check-advisories` checks.
 */
const CREATE_NEXT_APP_VERSION = "16.4.2";

/** Scaffolds a new Next.js App Router project with `create-next-app`. */
export class NextScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Next.js";
  readonly supportedFrameworks: ReadonlyArray<string> = ["next"];
  readonly nodeEngines: NodeEngines = {
    label: "create-next-app",
    spec: `create-next-app@${CREATE_NEXT_APP_VERSION}`,
    fallback: ">=20.9.0",
    enforcement: "warn",
  };
  override readonly pinnedPackages: ReadonlyArray<string> = [
    `create-next-app@${CREATE_NEXT_APP_VERSION}`,
    `next@${CREATE_NEXT_APP_VERSION}`,
  ];

  /**
   * Runs the pinned `create-next-app` version in `cwd`, creating a TypeScript
   * App Router project in place. `--yes` accepts all defaults so the command
   * runs unattended, and `--skip-install` leaves dependency installation to the
   * setup command's explicit next step after Zitadel patches package.json.
   */
  protected async create(cwd: string, _framework: string): Promise<void> {
    this.runCommand(
      "npx",
      [
        "--yes",
        `create-next-app@${CREATE_NEXT_APP_VERSION}`,
        ".",
        "--ts",
        "--app",
        "--use-npm",
        "--disable-git",
        "--yes",
        "--skip-install",
      ],
      cwd,
    );
  }
}
