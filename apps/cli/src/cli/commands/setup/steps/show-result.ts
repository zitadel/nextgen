import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import {
  pickWrittenFile,
  relativeDisplayPath as relativeDisplay,
} from "@/cli/commands/setup/shared";
import { DEFAULT_FLOW_CONFIG_PATH, DEFAULT_SCHEMA_CONFIG_PATH } from "@zitadel/config/defaults";
import { credentialVariables, providerOf, selectionName } from "@zitadel/config/idp";
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
import { dim, id as styleId, path as stylePath, url as styleUrl } from "@/lib/style";
import { WHAT_CHANGED } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import type { Summary } from "@/lib/ui";
import { type Fact as SummaryFact, section } from "@/lib/ui";
import { CONFIG_DIRECTORIES, PasswordPolicy } from "@/lib/zitadel";

import type { CommandResult } from "@/lib/oclif";
import { WizardStep } from "@/lib/wizard";
import { basename, join } from "node:path";
import semver from "semver";

import { pathExists } from "@/lib/fs";
import { readPackageJson } from "@/lib/npm";
import { detectors } from "@/lib/orca/detectors";
import { detectPackageManager } from "@/lib/package-manager";

/**
 * The line a finished setup closes on.
 */
const SET_UP_TITLE = "Set up Zitadel in this app";

/**
 * The line a dry run closes on.
 */
const WOULD_SET_UP_TITLE = "Would set up Zitadel in this app (dry run)";

/**
 * Joins a list of names the way a sentence does.
 */
const CONJUNCTION = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * The rows of the "Installed" section that name a file by the suffix of its
 * path: a union over every framework's scaffold artifacts, whose rows only
 * render when the patcher actually wrote the file, so the entries for other
 * frameworks are inert. Suffixes are matched case-sensitively (`src/App.tsx`
 * is React or Solid, `src/app.tsx` is Qwik, `app.vue` is the Nuxt shell,
 * `src/App.vue` is Vue).
 */
const INSTALLED_FILES = [
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
] as const;

/**
 * The login-customization entry points: what a user edits to change what the
 * login collects, how it authenticates and what it enforces. Burying them in
 * the verbose per-file narration above the box means users do not find them,
 * so each folder ships a README with the workflow.
 */
const CUSTOMIZE_FILES = [
  ["User schema", DEFAULT_SCHEMA_CONFIG_PATH, CONFIG_DIRECTORIES.schemas],
  ["Login flow", DEFAULT_FLOW_CONFIG_PATH, CONFIG_DIRECTORIES.flows],
  ["Password policy", PasswordPolicy.PATH, CONFIG_DIRECTORIES.policies],
] as const;

/**
 * What the step reads from what is known.
 */
type Needs = Fact<
  | "allFilesWritten"
  | "answers"
  | "app"
  | "commit"
  | "deployment"
  | "found"
  | "hostsPlatform"
  | "installOutcome"
  | "isLocal"
  | "issuer"
  | "ownedByLocalAdmin"
  | "patched"
  | "planned"
  | "project"
  | "scaffoldedFramework"
  | "signIn"
  | "ssoOutcomes"
>;

/**
 * What the step is given by the command.
 */
type Deps = Pick<
  SetupServices,
  "cliVersion" | "cwd" | "dryRun" | "isJson" | "realRun" | "suggest" | "ui"
>;

/**
 * Words what the run did as the command's result: the summary, the next steps
 * and the envelope.
 */
export class ShowResult extends WizardStep<"result", Readonly<{ answer: CommandResult }>, Needs> {
  readonly key = "result";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Build the result.
   *
   * @remarks
   * Words what the run did: the summary a person reads, the next steps, and the
   * envelope the command answers with.
   *
   * The claim nudge rides both surfaces from one decision: the box for humans,
   * the envelope for agents. It joins `boxActions` rather than being held back
   * from it. That list is journey-staged by omission (customize/publish is
   * absent until login works), and this is not part of that
   * journey: attaching a team is orthogonal to whether login works yet, exactly
   * as in `status`. Position in the list carries no staging meaning, so
   * appending is not a way of deferring it.
   *
   * It is nudged on the cloud, and on a local server that actually hosts the
   * platform plane: `claimState` is offline and gates local to
   * not-applicable, but setup is online anyway, so it asks the server's
   * runtime document (see localServerHostsPlatform). A dry run contacts no
   * platform, so it previews the nudge for local servers optimistically
   * instead of probing. On a CLI-managed local server the developer already
   * exists as the local admin, so the project is attached to their team right
   * away and `zitadel claim` has nothing left to do: claiming an anonymous
   * project stays a cloud journey.
   *
   * The deadline is concrete because the server enforces the claim window at
   * claim time and the project was created moments ago, so `created_at`
   * computes the same date the platform will hold the user to. A dry run gets
   * the generic wording: its stand-in project has a fixed past `created_at`,
   * and no real window started anyway.
   *
   * The console step is offered only when the project is the local admin's: the
   * console lists nothing else for them, so the command would open an empty
   * console otherwise. `console` finds the server from its directory up, so a
   * run with `--cwd` passes it on. A run that skipped social sign-in says how to
   * add it later, the way the console step says how to open the console.
   *
   * The preview's one follow-up is this run again without `--dry-run`, with
   * every other flag as typed.
   *
   * The structured report is human-only: under `--json` the envelope returned
   * the command emits is the sole stdout payload, since oclif requires a
   * single JSON document. The summary and the report are only worked out for a
   * person's output, after the project facts are read, and the report only when
   * nothing is drawn live. The ending is only what sits under the closing line,
   * so the headline is added to it.
   *
   * The summary is one section per fact group, drawn through the layout every other
   * command's box uses: a heading, then `label   value` rows it aligns. A row's secondary is
   * already styled (a path, a url), and the palette spells out whatever it is given, so only the
   * brackets are dimmed: dimming the whole would print the styling's own escape as the text
   * `\\x1b[36m`. A section without rows is dropped.
   *
   * Each provider gets its own "Social sign-in" row because each has its own
   * connection file, and a developer scanning the summary for where to edit
   * needs the path that belongs to the provider they are looking at. A scripted
   * `--sso` run asks nothing, so the prompt that announces the redirect URI never
   * shows; the summary is where it reaches the developer then. The Vite config
   * merge carries the `/__nextgen` dev proxy, and its file name varies
   * (ts/js/mts/mjs), so it cannot ride the suffix table. The sign-in section says
   * what a user meets at sign-in, so a preset's name is not the only record of
   * it: `password-first` enables passkeys too, and profile fields are optional.
   *
   * The framework line reads the on-disk markers (lock file, tsconfig, framework dependency
   * version) without any platform call. A missing or unreadable package.json leaves the version
   * out, which is the same as the user not having declared the framework dependency yet. The
   * version is the lowest one the declared range admits, so `^15.0.0`, `>= 15.0.0`, `=15.0.0`
   * and `^15.0.0 || ^14.0.0` all read `15.0.0` and `20.1.x` reads `20.1.0`. A spec that is not a
   * valid semver range (`catalog:`, `workspace:*`, `file:`, git URLs, dist-tags such as `latest`)
   * or names no version (`*`) shows none, because printing it as the framework version would be
   * wrong.
   *
   * The envelope's `files` holds typed per-artifact rows for the scaffolded app
   * files (the configuration files continue to report through `files_written`):
   * one row per touched path with kind (file or dir) and action (create or
   * update), so agents can verify what setup did without parsing narration.
   * `sign_in` is what sign-in and registration are configured to do, read off
   * what setup published rather than the preset's name. `sso` is a list, one
   * entry per provider enabled during scaffolding and empty when none was: an
   * agent reading this needs to know which provider a deferred publish belongs
   * to, so the outcomes stay per entry. Its `callback_uri` is what the developer
   * registers at the provider: the connection's own route, as
   * `auth-method sso enable` reports it. `deployment` is what setup's first
   * deploy published, or null when there was none: a dry run, or a deploy that
   * failed, which is a warning. `git` says whether setup ran `git init`, even if the commit then
   * failed, and the commit, or null.
   *
   * A JSON run prints no warnings, so a credential the project never received
   * would otherwise appear only as a `published` status with nothing to act on:
   * `auth-method sso enable` reports the same recovery step. The box holds the
   * next steps, so the base command does not repeat them.
   *
   * @param needs - Everything the run came to know.
   * @returns The result the command answers with.
   */
  async run(needs: Needs): Promise<Readonly<{ answer: CommandResult }>> {
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
    const deployCommand = this.deps.suggest({
      id: "deploy",
      flags: { message: WHAT_CHANGED },
    });
    const deployStep =
      deployment === undefined && !this.deps.dryRun
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

    const deadline = this.deps.dryRun ? undefined : claimWindowDeadline(project.created_at);
    const claimNudge =
      !ownedByLocalAdmin &&
      (claimState({
        secret: {},
        server: answers.server,
      }).kind === "detached" ||
        (isLocal && (this.deps.dryRun || hostsPlatform)))
        ? {
            actions: [claimAction(this.deps.suggest, deadline)],
            boxActions: [claimBoxAction(this.deps.suggest, deadline)],
            commands: [claimCommand(this.deps.suggest)],
          }
        : {
            actions: [],
            boxActions: [],
            commands: [],
          };
    const consoleCommand = this.deps.suggest({ id: "console" });
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
    const ssoCommand = this.deps.suggest({
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
    const realRun = this.deps.dryRun ? await this.deps.realRun() : undefined;
    const title = this.deps.dryRun ? WOULD_SET_UP_TITLE : SET_UP_TITLE;
    if (!this.deps.dryRun) {
      this.deps.ui.ranAgainst(project.id, answers.server);
    }
    const projectFacts = this.deps.isJson
      ? undefined
      : await Promise.all([
          pathExists(join(this.deps.cwd, "tsconfig.json")),
          detectPackageManager(this.deps.cwd),
          readPackageJson(this.deps.cwd).catch(() => {
            return undefined;
          }),
        ]).then(([typescript, packageManager, packageJson]) => {
          return {
            typescript,
            packageManager,
            packageJson,
          };
        });
    const detector = detectors.find((candidate) => {
      return candidate.framework === app.framework;
    });
    const dependency = detector?.versionPackage ?? app.framework;
    const range =
      projectFacts?.packageJson?.dependencies?.[dependency] ??
      projectFacts?.packageJson?.devDependencies?.[dependency];
    const version =
      range && /\d/.test(range) && semver.validRange(range) !== null
        ? semver.minVersion(range)?.version
        : undefined;
    const written = allFilesWritten.map((file) => {
      return relativeDisplay(this.deps.cwd, file);
    });
    const packageJsonHit = pickWrittenFile(written, "package.json");
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
              `Zitadel asks ${text(connection.displayName)} for these scopes: ${CONJUNCTION.format(scopes.map(text))}.`,
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
              `This connection is used by ${CONJUNCTION.format(usedBy.map(text))}, so a change here affects the people who sign in with it.`,
            ],
        [
          `To change which claim fills an attribute, edit claim_mapping in ${text(connection.path)} and run deploy.`,
        ],
      ].filter((lines) => {
        return lines.length > 0;
      });
      return [
        "",
        ...sections.flatMap((lines, at) => {
          return at === 0 ? lines : ["", ...lines];
        }),
      ];
    });
    const summary: Summary =
      projectFacts === undefined
        ? {
            title,
            sections: [],
          }
        : {
            title,
            sections: [
              section(
                "Detected",
                [
                  "Framework",
                  [
                    version
                      ? `${detector?.displayName ?? app.framework} ${version}`
                      : (detector?.displayName ?? app.framework),
                    ...(projectFacts.typescript ? ["TypeScript"] : []),
                    projectFacts.packageManager,
                  ].join(` ${dim("·")} `),
                ],
                ...(scaffoldedFramework
                  ? [
                      [
                        "Scaffold",
                        found.scaffoldedBesideFiles
                          ? "new project over existing files (--force)"
                          : "new project",
                      ] as const,
                    ]
                  : []),
              ),
              section(
                "Installed",
                ...(packageJsonHit && result.depsAdded.length > 0
                  ? [
                      [
                        "Package",
                        `${result.depsAdded.join(", ")} ${dim("(")}${stylePath(basename(packageJsonHit))}${dim(")")}`,
                      ] as const,
                    ]
                  : []),
                ...INSTALLED_FILES.flatMap(([label, suffix]): ReadonlyArray<SummaryFact> => {
                  const hit = pickWrittenFile(written, suffix);
                  return hit ? [[label, stylePath(hit)]] : [];
                }),
                ...written
                  .filter((file) => {
                    return /(^|\/)vite\.config\.[cm]?[jt]s$/.test(file);
                  })
                  .slice(0, 1)
                  .map((file): SummaryFact => {
                    return ["Dev proxy", stylePath(file)];
                  }),
              ),
              section(
                "Sign-in",
                ["Starts with", signIn.starts_with],
                ["Methods", signIn.methods.join(", ")],
                [
                  "Registration",
                  signIn.fields
                    .map((field) => {
                      return `${field.name}${field.required ? "" : " (optional)"}`;
                    })
                    .join(", "),
                ],
                [
                  "Passwords",
                  signIn.password_min_length === null
                    ? "no minimum length"
                    : `at least ${signIn.password_min_length} characters`,
                ],
              ),
              section(
                "Customize",
                ...CUSTOMIZE_FILES.flatMap(([label, suffix, dir]): ReadonlyArray<SummaryFact> => {
                  return pickWrittenFile(written, suffix)
                    ? [[label, `${stylePath(`${dir}/`)} ${dim("(")}see its README.md${dim(")")}`]]
                    : [];
                }),
                ...planned.connections.flatMap((entry): ReadonlyArray<SummaryFact> => {
                  const provider = providerOf(entry.chosen.selection);
                  return [
                    [
                      "Social sign-in",
                      `${provider.displayName} ${dim("(")}${stylePath(entry.connection.path)}${dim(")")}`,
                    ],
                    ["Redirect URI", styleUrl(callbackUriFor(issuer, provider.slug))],
                  ];
                }),
              ),
              section(
                "Project",
                ["Project id", styleId(project.id)],
                ["Server", styleUrl(answers.server)],
                ["App will run", styleUrl(issuer)],
              ),
            ].filter((drawn) => {
              return drawn.facts.length > 0;
            }),
            lines: connectionLines[0] === "" ? connectionLines.slice(1) : connectionLines,
            next: nextActions,
            boxed: true,
          };
    const [exploreText = "", exploreCommand] = exploreAllCommands(this.deps.cliVersion)
      .split("\n")
      .map((line) => {
        return line.trim();
      });
    const report =
      this.deps.isJson || this.deps.ui.interactive
        ? ""
        : `${title}\n${this.deps.ui.ending({
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
          })}`;

    return {
      answer: {
        status: "ok",
        data: {
          title,
          ...(this.deps.dryRun ? { dry_run: true } : {}),
          project: {
            project_id: project.id,
            issuer,
          },
          framework: app.framework,
          server: answers.server,
          files_written: written,
          files: result.files.map((file) => {
            return {
              path: relativeDisplay(this.deps.cwd, file.path),
              kind: file.kind,
              action: file.action,
            };
          }),
          files_skipped: result.filesSkipped.map((file) => {
            return relativeDisplay(this.deps.cwd, file);
          }),
          install: installOutcome.install,
          git: {
            initialized:
              commit.kind === "created" ||
              (commit.kind === "unavailable" && commit.createdRepository),
            commit: commit.kind === "created" || commit.kind === "committed" ? commit.sha : null,
          },
          sign_in: signIn,
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
            brandingGuidanceAction(this.deps.suggest),
            ...consoleStep.actions,
            ...ssoStep.actions,
            ...claimNudge.actions,
          ],
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
              this.deps.suggest,
            ),
            ...deployStep.commands,
            ...installOutcome.nextCommands,
            ...consoleStep.commands,
            ...ssoStep.commands,
            ...(realRun === undefined ? [] : [realRun]),
            ...claimNudge.commands,
          ],
        },
        nextShown: this.deps.isJson ? undefined : asStepsShown(),
      },
    };
  }
}
