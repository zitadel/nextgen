import {
  pickWrittenFile,
  relativeDisplayPath as relativeDisplay,
  type SignIn,
} from "@/cli/commands/setup/shared";
import { DEFAULT_FLOW_CONFIG_PATH, DEFAULT_SCHEMA_CONFIG_PATH } from "@zitadel/config/defaults";
import { credentialVariables, providerOf, selectionName } from "@zitadel/config/idp";
import type { CreatedProject } from "@/lib/backend";
import {
  claimAction,
  claimBoxAction,
  claimCommand,
  claimState,
  claimWindowDeadline,
} from "@/lib/claim-state";
import { callbackUriFor, republishCommands } from "@/lib/idp";
import { brandingGuidanceAction, exploreAllCommands } from "@/lib/journey-guidance";
import { asStepsShown } from "@/lib/oclif/next-steps";
import { painted } from "@/lib/oclif/rendering";
import { id as styleId, path as stylePath, url as styleUrl, dim } from "@/lib/style";
import { WHAT_CHANGED } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import type { Summary } from "@/lib/ui";
import { CONFIG_DIRECTORIES, PasswordPolicy, type ScaffoldedConnection } from "@/lib/zitadel";

import type { JsonEnvelope } from "@/lib/oclif";
import { WizardStep } from "@/lib/wizard";

import type { SetupFacts, SetupServices } from "@/cli/commands/setup/shared";
import type { InitialCommitOutcome } from "@/cli/commands/setup/steps/make-initial-commit";
import { basename, join } from "node:path";
import semver from "semver";

import { pathExists } from "@/lib/fs";
import { readPackageJson } from "@/lib/npm";
import { detectors } from "@/lib/orca/detectors";
import type { Detector } from "@/lib/orca/detectors/types";
import { detectPackageManager, type PackageManager } from "@/lib/package-manager";
import { type Fact, type Section as UiSection, section as uiSection } from "@/lib/ui";

/** The line a finished setup closes on. */
const SET_UP_TITLE = "Set up Zitadel in this app";

/** The line a dry run closes on. */
const WOULD_SET_UP_TITLE = "Would set up Zitadel in this app (dry run)";

/**
 * Words what the run did as the command's result: the summary, the next steps
 * and the envelope.
 */
export class ShowResult extends WizardStep<
  "result",
  Readonly<{ answer: JsonEnvelope }>,
  SetupFacts,
  SetupServices
> {
  readonly key = "result";

  /**
   * Build the result.
   *
   *
   * Words what the run did: the summary a person reads, the next steps, and the
   * envelope the command answers with.
   * @param needs - Everything the run came to know.
   * @param services - What the command provides.
   * @returns The result the command answers with.
   */
  async run(
    needs: SetupFacts,
    services: SetupServices,
  ): Promise<Readonly<{ answer: JsonEnvelope }>> {
    const {
      allFilesWritten,
      answers,
      app,
      commit,
      deployment,
      found,
      hostsPlatform,
      installOutcome,
      isLocal,
      issuer,
      ownedByLocalAdmin,
      patched: result,
      planned,
      project,
      scaffoldedFramework,
      signIn,
      ssoOutcomes,
    } = needs;
    const { scaffoldedBesideFiles } = found;
    const deployCommand = services.suggest({
      id: "deploy",
      flags: { message: WHAT_CHANGED },
    });
    const deployStep =
      deployment === undefined && !services.dryRun
        ? {
            actions: [`Deploy .zitadel/ so the project serves its release: ${deployCommand}`],
            boxActions: [
              {
                text: "Deploy .zitadel/ so the project serves its release:",
                command: deployCommand,
              },
            ],
            commands: [deployCommand],
          }
        : {
            actions: [],
            boxActions: [],
            commands: [],
          };

    const writtenRel = allFilesWritten.map((file) => {
      return relativeDisplay(services.cwd, file);
    });
    // The nudge rides both surfaces from one decision: the box for humans, the
    // envelope for agents.
    //
    // It joins `boxActions` rather than being held back from it. That list is
    // journey-staged by *omission* (customize/publish is absent until login
    // works, see `install.ts`), and this is not part of that journey: attaching
    // a team is orthogonal to whether login works yet, exactly as in `status`.
    // Position in the list carries no staging meaning, so appending is not a
    // way of deferring it.
    //
    // Nudged on the cloud, and on a local server that actually hosts the
    // platform plane: `claimState` is offline and gates local to
    // not-applicable, but setup is online anyway, so it asks the server's
    // runtime document (see localServerHostsPlatform). A dry run contacts no
    // platform, so it previews the nudge for local servers optimistically
    // instead of probing.
    // The deadline is concrete because the server enforces the claim window
    // at claim time and the project was created moments ago, so created_at
    // computes the same date the platform will hold the user to. A dry run
    // gets the generic wording: its stand-in project has a fixed past
    // created_at, and no real window started anyway.
    // On a CLI-managed local server the developer already exists as the local
    // admin, so the project is attached to their team right away and
    // `zitadel claim` has nothing left to do. Claiming an anonymous project
    // stays a cloud journey.
    const deadline = services.dryRun ? undefined : claimWindowDeadline(project.created_at);
    const nudgeClaim =
      !ownedByLocalAdmin &&
      (claimState({
        secret: {},
        server: answers.server,
      }).kind === "detached" ||
        (isLocal && (services.dryRun || hostsPlatform)));
    const claimNudge = nudgeClaim
      ? {
          actions: [claimAction(services.suggest, deadline)],
          boxActions: [claimBoxAction(services.suggest, deadline)],
          commands: [claimCommand(services.suggest)],
        }
      : {
          actions: [],
          boxActions: [],
          commands: [],
        };
    // Only when the project is the local admin's: the console lists nothing
    // else for them, so the command would open an empty console otherwise.
    // `console` finds the server from its directory up, so a run with `--cwd`
    // passes it on.
    const consoleCommand = services.suggest({ id: "console" });
    const consoleStep = ownedByLocalAdmin
      ? {
          actions: [
            `Manage the project in the local console as ${escapeControlCharacters(ownedByLocalAdmin.email)}: ${consoleCommand}`,
          ],
          boxActions: [
            {
              text: `Manage the project in the local console, signed in as ${escapeControlCharacters(ownedByLocalAdmin.email)}:`,
              command: consoleCommand,
            },
          ],
          commands: [consoleCommand],
        }
      : {
          actions: [],
          boxActions: [],
          commands: [],
        };
    // A run that skipped social sign-in says how to add it later, the way
    // `consoleStep` says how to open the console.
    const ssoCommand = services.suggest({
      id: "auth-method:sso:enable",
      flags: { provider: "google" },
    });
    const ssoStep =
      answers.sso.length === 0
        ? {
            actions: [`Add social sign-in whenever you are ready: ${ssoCommand}`],
            boxActions: [
              {
                text: "Add social sign-in, such as Google, whenever you are ready:",
                command: ssoCommand,
              },
            ],
            commands: [ssoCommand],
          }
        : {
            actions: [],
            boxActions: [],
            commands: [],
          };
    // This run again without `--dry-run`, with every other flag as typed, which
    // is what a preview's one follow-up is.
    const realRun = services.dryRun ? await services.realRun() : undefined;
    // The structured report is human-only. Under `--json` we let the
    // envelope returned from `services.emit(...)` be the sole stdout
    // payload (oclif requires single-doc JSON).
    const title = services.dryRun ? WOULD_SET_UP_TITLE : SET_UP_TITLE;
    // biome-ignore lint/plugin: assigned only for a person's output, after the project facts are read
    let summary: Summary = {
      title,
      sections: [],
    };
    // biome-ignore lint/plugin: assigned only when nothing is drawn live, from the summary
    let report = "";
    if (!services.dryRun) {
      services.ui.ranAgainst(project.id, answers.server);
    }
    if (!services.isJson) {
      const projectFacts = await detectProjectFacts(services.cwd, app.framework);
      const sections = buildSummary({
        projectFacts,
        writtenRel,
        depsAdded: result.depsAdded,
        project,
        server: answers.server,
        issuer,
        scaffoldedFramework,
        scaffoldedBesideFiles,
        connections: planned.connections,
        signIn,
      });
      const nextActions = [
        ...deployStep.boxActions,
        ...installOutcome.boxActions,
        ...consoleStep.boxActions,
        ...ssoStep.boxActions,
        ...claimNudge.boxActions,
        ...(realRun === undefined
          ? []
          : [
              {
                text: "Set it up for real:",
                command: realRun,
              },
            ]),
      ];
      const connectionLines = planned.connections.flatMap((entry) => {
        const connection = entry.connection;
        const text = (value: string) => {
          return escapeControlCharacters(value, { keepLayout: false });
        };
        const { mappings, verifications, scopes, createsUsers, unmapped, usedBy } =
          planned.change.after.connections.summarize(connection);
        const verifiedBy = new Map(
          verifications.flatMap(({ property, claim }): ReadonlyArray<readonly [string, string]> => {
            if (claim === true) {
              return [[property, "always counts as verified"]];
            }
            if (typeof claim === "string") {
              return [[property, `counts as verified when ${text(claim)} is true`]];
            }
            return [];
          }),
        );
        const sections = [
          mappings.length === 0
            ? []
            : [
                createsUsers
                  ? `When someone signs in with ${text(connection.displayName)} for the first time, Zitadel fills in their new user like this:`
                  : `${text(connection.displayName)} does not create users in Zitadel, so these claims are not used to fill one:`,
                ...mappings.map(({ property, claim }) => {
                  const verified = verifiedBy.get(property) ?? "is not treated as verified";
                  return [
                    `- ${text(property)} comes from the provider's ${text(claim)} claim.`,
                    `  It ${verified}.`,
                  ].join("\n");
                }),
              ],
          scopes.length === 0
            ? []
            : [
                `Zitadel asks ${text(connection.displayName)} for these scopes: ${new Intl.ListFormat("en", { type: "conjunction" }).format(scopes.map(text))}.`,
              ],
          unmapped.length === 0
            ? []
            : [
                "These attributes have no claim yet:",
                ...unmapped.map(({ property, required }) => {
                  if (!required) {
                    return `- ${text(property)} is optional, so it can stay empty.`;
                  }
                  return createsUsers
                    ? `- ${text(property)} is required, so sign-up will have to ask for it.`
                    : `- ${text(property)} is required, but this connection does not create users.`;
                }),
              ],
          usedBy.length === 0
            ? []
            : [
                `This connection is used by ${new Intl.ListFormat("en", { type: "conjunction" }).format(usedBy.map(text))}, so a change here affects the people who sign in with it.`,
              ],
          [
            `To change which claim fills an attribute, edit claim_mapping in ${text(connection.path)} and run deploy.`,
          ],
        ].filter((section) => {
          return section.length > 0;
        });
        return [
          "",
          ...sections.flatMap((section, at) => {
            return at === 0 ? section : ["", ...section];
          }),
        ];
      });
      summary = {
        title,
        sections: summarySections(sections),
        lines: connectionLines[0] === "" ? connectionLines.slice(1) : connectionLines,
        next: nextActions,
        boxed: true,
      };
      if (!services.ui.interactive) {
        const [exploreText = "", exploreCommand] = exploreAllCommands(services.cliVersion)
          .split("\n")
          .map((line) => {
            return line.trim();
          });
        const ending = services.ui.ending({
          ...summary,
          next: [
            ...nextActions,
            ...(exploreCommand === undefined
              ? []
              : [
                  {
                    text: exploreText,
                    command: exploreCommand,
                  },
                ]),
          ],
        });
        // The ending is only what sits under the closing line, so the headline is added.
        report = `${title}\n${ending}`;
      }
    }

    return {
      answer: await services.emit({
        status: "ok",
        data: {
          title,
          ...(services.dryRun ? { dry_run: true } : {}),
          project: {
            project_id: project.id,
            issuer,
          },
          framework: app.framework,
          server: answers.server,
          files_written: allFilesWritten.map((file) => {
            return relativeDisplay(services.cwd, file);
          }),
          // Typed per-artifact rows for the scaffolded app files (the
          // configuration files continue to report through files_written): one row per
          // touched path with kind (file/dir) and action (create/update), so
          // agents can verify what setup did without parsing narration.
          files: result.files.map((file) => {
            return {
              path: relativeDisplay(services.cwd, file.path),
              kind: file.kind,
              action: file.action,
            };
          }),
          files_skipped: result.filesSkipped.map((file) => {
            return relativeDisplay(services.cwd, file);
          }),
          install: installOutcome.install,
          git: gitReport(commit),
          // What sign-in and registration are configured to do, read off what
          // setup published rather than the preset's name.
          sign_in: signIn,
          // A list, one entry per provider enabled during scaffolding, empty
          // when none was. An agent reading this needs to know which provider a
          // deferred publish belongs to, so the outcomes stay per entry.
          sso: planned.connections.map((entry) => {
            const slug = providerOf(entry.chosen.selection).slug;
            const outcome = ssoOutcomes.get(slug);
            const mapped = planned.change.after.connections.summarize(entry.connection);
            return {
              provider: selectionName(entry.chosen.selection),
              slug,
              client_id: entry.chosen.credentials.clientId ?? null,
              connection: entry.connection.path,
              claim_mapping: Object.fromEntries(
                mapped.mappings.map(({ property, claim }) => {
                  return [property, claim];
                }),
              ),
              verified_claims: Object.fromEntries(
                mapped.verifications.map(({ property, claim }) => {
                  return [property, claim];
                }),
              ),
              scopes: mapped.scopes,
              unmapped: mapped.unmapped,
              used_by: mapped.usedBy,
              // What the developer registers at the provider: the connection's
              // own route, as `auth-method sso enable` reports it.
              callback_uri: callbackUriFor(issuer, slug),
              client_id_variable: outcome
                ? {
                    variable: credentialVariables(slug).clientId,
                    published: outcome.clientId,
                  }
                : null,
              secret: outcome
                ? {
                    variable: outcome.secret.name,
                    published: outcome.secret.published,
                  }
                : null,
            };
          }),
          // What setup's first deploy published, or null when there was none:
          // a dry run, or a deploy that failed, which is a warning.
          deployment:
            deployment === undefined
              ? null
              : {
                  release_id: deployment.releaseId,
                  content_hash: deployment.contentHash,
                  deployment_id: deployment.deploymentId,
                  origins: [...deployment.origins],
                },
        },
        ...(report === "" ? {} : { pretty: painted(report) }),
        summary,
        next: {
          actions: [
            ...deployStep.actions,
            ...installOutcome.nextActions,
            brandingGuidanceAction(services.suggest),
            ...consoleStep.actions,
            ...ssoStep.actions,
            ...claimNudge.actions,
          ],
          // A JSON run prints no warnings, so a credential the project never
          // received would otherwise appear only as a `published` status with
          // nothing to act on. `auth-method sso enable` reports the same recovery step.
          commands: [
            ...republishCommands(
              answers.sso.flatMap((answer) => {
                const slug = providerOf(answer.selection).slug;
                const outcome = ssoOutcomes.get(slug);
                return [
                  {
                    name: credentialVariables(slug).clientId,
                    secret: false,
                    published: outcome?.clientId,
                  },
                  {
                    name: outcome?.secret.name,
                    secret: true,
                    published: outcome?.secret.published,
                  },
                ];
              }),
              services.suggest,
            ),
            ...deployStep.commands,
            ...installOutcome.nextCommands,
            ...consoleStep.commands,
            ...ssoStep.commands,
            ...(realRun === undefined ? [] : [realRun]),
            ...claimNudge.commands,
          ],
        },
        // The box holds the next steps, so the base command does not repeat them.
        nextShown: services.isJson ? undefined : asStepsShown(),
      }),
    };
  }
}

/**
 * Builds the section list driving {@link summarySections} for the setup command.
 * Exported so its wording is unit-tested.
 */
export function buildSummary(opts: {
  projectFacts: Awaited<ReturnType<typeof detectProjectFacts>>;
  writtenRel: string[];
  depsAdded: ReadonlyArray<string>;
  project: CreatedProject;
  server: string;
  issuer: string;
  scaffoldedFramework: boolean;
  scaffoldedBesideFiles: boolean;
  connections: readonly ScaffoldedConnection[];
  signIn: SignIn;
}): Section[] {
  const {
    projectFacts,
    writtenRel,
    depsAdded,
    project,
    server,
    issuer,
    scaffoldedFramework,
    connections,
  } = opts;
  const packageJsonHit = pickWrittenFile(writtenRel, "package.json");

  const detected: Row[] = [
    {
      label: "Framework",
      value: formatFrameworkLine(projectFacts),
    },
  ];
  if (scaffoldedFramework) {
    detected.push({
      label: "Scaffold",
      value: opts.scaffoldedBesideFiles
        ? "new project over existing files (--force)"
        : "new project",
    });
  }

  const installedRows: Row[] = [];
  if (packageJsonHit && depsAdded.length > 0) {
    installedRows.push({
      label: "Package",
      value: depsAdded.join(", "),
      secondary: stylePath(fileNameOf(packageJsonHit)),
    });
  }
  // A union over every framework's scaffold artifacts: rows only render when
  // the patcher actually wrote the file, so entries for other frameworks are
  // inert. Suffixes are matched case-sensitively (src/App.tsx is React/Solid,
  // src/app.tsx is Qwik, app.vue is the Nuxt shell, src/App.vue is Vue).
  for (const [label, suffix] of [
    ["Home redirect", "app/page.tsx"],
    ["Login page", "app/login/page.tsx"],
    ["Register page", "app/register/page.tsx"],
    ["Profile page", "app/profile/page.tsx"],
    ["Request proxy", "proxy.ts"],
    ["Middleware", "middleware.ts"],
    ["App entry", "src/App.tsx"],
    ["App entry", "src/app.tsx"],
    ["App entry", "src/App.vue"],
    ["App entry", "src/App.svelte"],
    ["App entry", "src/app/app.ts"],
    ["Routes", "src/app/app.routes.ts"],
    ["Request proxy", "proxy.conf.cjs"],
    ["App shell", "app.vue"],
    ["Home redirect", "pages/index.vue"],
    ["Login page", "pages/login.vue"],
    ["Register page", "pages/register.vue"],
    ["Profile page", "pages/profile.vue"],
    ["Env vars", ".env.local"],
  ] as const) {
    const hit = pickWrittenFile(writtenRel, suffix);
    if (hit) {
      installedRows.push({
        label,
        value: stylePath(hit),
      });
    }
  }
  // The Vite config merge carries the /__nextgen dev proxy; the file name
  // varies (ts/js/mts/mjs), so it can't ride the suffix table above.
  const viteConfigHit = writtenRel.find((file) => {
    return /(^|\/)vite\.config\.[cm]?[jt]s$/.test(file);
  });
  if (viteConfigHit) {
    installedRows.push({
      label: "Dev proxy",
      value: stylePath(viteConfigHit),
    });
  }

  // The login-customization entry points. These are what a user edits to
  // change what the login collects, how it authenticates and what it enforces —
  // burying them in the verbose per-file narration above the box means users
  // don't find them (each folder ships a README with the workflow).
  const customizeRows: Row[] = [];
  for (const [label, suffix, dir] of [
    ["User schema", DEFAULT_SCHEMA_CONFIG_PATH, CONFIG_DIRECTORIES.schemas],
    ["Login flow", DEFAULT_FLOW_CONFIG_PATH, CONFIG_DIRECTORIES.flows],
    ["Password policy", PasswordPolicy.PATH, CONFIG_DIRECTORIES.policies],
  ] as const) {
    const hit = pickWrittenFile(writtenRel, suffix);
    if (hit) {
      customizeRows.push({
        label,
        value: stylePath(`${dir}/`),
        secondary: "see its README.md",
      });
    }
  }
  // One row per provider: each has its own connection file, and a developer
  // scanning the summary for where to edit needs the path that belongs to the
  // provider they are looking at.
  for (const entry of connections) {
    const provider = providerOf(entry.chosen.selection);
    customizeRows.push({
      label: "Social sign-in",
      value: provider.displayName,
      secondary: stylePath(entry.connection.path),
    });
    // A scripted `--sso` run asks nothing, so the prompt that announces the
    // URI never shows; the summary is where it reaches the developer then.
    customizeRows.push({
      label: "Redirect URI",
      value: styleUrl(callbackUriFor(issuer, provider.slug)),
    });
  }

  // What a user meets at sign-in, so a preset's name is not the only record of
  // it: `password-first` enables passkeys too, and profile fields are optional.
  const { signIn } = opts;

  return [
    {
      title: "Detected",
      rows: detected,
    },
    {
      title: "Installed",
      rows: installedRows,
    },
    {
      title: "Sign-in",
      rows: [
        {
          label: "Starts with",
          value: signIn.starts_with,
        },
        {
          label: "Methods",
          value: signIn.methods.join(", "),
        },
        {
          label: "Registration",
          value: signIn.fields
            .map((field) => {
              return `${field.name}${field.required ? "" : " (optional)"}`;
            })
            .join(", "),
        },
        {
          label: "Passwords",
          value:
            signIn.password_min_length === null
              ? "no minimum length"
              : `at least ${signIn.password_min_length} characters`,
        },
      ],
    },
    {
      title: "Customize",
      rows: customizeRows,
    },
    {
      title: "Project",
      rows: [
        {
          label: "Project id",
          value: styleId(project.id),
        },
        {
          label: "Server",
          value: styleUrl(server),
        },
        {
          label: "App will run",
          value: styleUrl(issuer),
        },
      ],
    },
  ];
}

/**
 * Structured end-of-command summary: one row per fact, grouped under a
 * heading. Each {@link Row} carries the label, the primary value (already
 * styled by the caller), and an optional `secondary` — where to look next for
 * that row, said in the value rather than in a column of its own, because a
 * second column only lines up when every value in the group is the same width.
 */
export type Row = {
  label: string;
  value: string;
  secondary?: string;
};

export type Section = {
  title: string;
  rows: Row[];
};

/**
 * The section list as the facts every other command's box states: a heading,
 * then `label   value` rows the shared layout aligns ({@link UiSection}).
 *
 * Drawing them through the one layout is what makes setup's ending comparable
 * with every other command's at a glance.
 */
export function summarySections(sections: Section[]): UiSection[] {
  return sections
    .filter((section) => {
      return section.rows.length > 0;
    })
    .map((section) => {
      return uiSection(
        section.title,
        ...section.rows.map((row): Fact => {
          return [
            row.label,
            row.secondary === undefined
              ? row.value
              : // The secondary is already styled (a path, a url), and the palette spells out
                // whatever it is given, so only the brackets are dimmed: dimming the whole
                // would print the styling's own escape as the text `\\x1b[36m`.
                `${row.value} ${dim("(")}${row.secondary}${dim(")")}`,
          ];
        }),
      );
    });
}

/**
 * Detected facts about the user's project, surfaced in the `DETECTED`
 * section. {@link detectProjectFacts} reads the on-disk markers (lock
 * file, tsconfig, framework dep version) without any platform call.
 */
export type ProjectFacts = {
  framework: string;
  frameworkVersion?: string;
  typescript: boolean;
  packageManager: PackageManager;
};

/**
 * Reads the project root to identify the framework version, TS presence,
 * and which package manager the user runs. Returns safe defaults (npm
 * fallback, no version) on any error so summary rendering can always proceed.
 */
export async function detectProjectFacts(cwd: string, frameworkId: string): Promise<ProjectFacts> {
  const facts: ProjectFacts = {
    framework: frameworkId,
    typescript: await pathExists(join(cwd, "tsconfig.json")),
    packageManager: await detectPackageManager(cwd),
  };
  // A missing or unreadable package.json leaves the version undefined; the
  // renderer skips that segment, which is the same as the user not having
  // declared the framework dep yet.
  const pj = await readPackageJson(cwd).catch(() => {
    return undefined;
  });
  const depPkg = depFromFramework(frameworkId);
  const range = pj?.dependencies?.[depPkg] ?? pj?.devDependencies?.[depPkg];
  const version = range ? stripRange(range) : undefined;
  if (version) {
    facts.frameworkVersion = version;
  }
  return facts;
}

/** Formats the project facts as the "Next.js 15 · TypeScript · npm" string the mock shows. */
export function formatFrameworkLine(facts: ProjectFacts): string {
  const segments: string[] = [];
  const pretty = prettyFramework(facts.framework);
  segments.push(facts.frameworkVersion ? `${pretty} ${facts.frameworkVersion}` : pretty);
  if (facts.typescript) segments.push("TypeScript");
  segments.push(facts.packageManager);
  return segments.join(` ${dim("·")} `);
}

function detectorFor(framework: string): Detector | undefined {
  return detectors.find((detector) => {
    return detector.framework === framework;
  });
}

function depFromFramework(framework: string): string {
  return detectorFor(framework)?.versionPackage ?? framework;
}

function prettyFramework(framework: string): string {
  return detectorFor(framework)?.displayName ?? framework;
}

/**
 * Reduces a declared npm range to the version the summary shows: the lowest
 * version it admits (`semver.minVersion`), so `^15.0.0`, `>= 15.0.0`,
 * `=15.0.0`, `^15.0.0 || ^14.0.0` all read `15.0.0` and `20.1.x` reads
 * `20.1.0`. Returns `undefined` when the spec is not a valid semver range
 * (`catalog:`, `workspace:*`, `file:`, git URLs, dist-tags such as `latest`) or
 * names no version (`*`), because printing that as the framework version would
 * be wrong.
 */
function stripRange(range: string): string | undefined {
  if (!/\d/.test(range) || semver.validRange(range) === null) return undefined;
  return semver.minVersion(range)?.version;
}

/** Returns just the file name from a relative path, for the `→ filename` secondary detail in PACKAGE rows. */
export function fileNameOf(p: string): string {
  return basename(p);
}

/** What `setup --json` reports under `git`: whether setup ran `git init`, even if the commit then failed, and the commit, or null. */
export function gitReport(outcome: InitialCommitOutcome): {
  readonly initialized: boolean;
  readonly commit: string | null;
} {
  if (outcome.kind === "created") {
    return {
      initialized: true,
      commit: outcome.sha,
    };
  }
  if (outcome.kind === "committed") {
    return {
      initialized: false,
      commit: outcome.sha,
    };
  }
  if (outcome.kind === "unavailable") {
    return {
      initialized: outcome.createdRepository,
      commit: null,
    };
  }
  return {
    initialized: false,
    commit: null,
  };
}
