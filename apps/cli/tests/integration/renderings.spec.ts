import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";
import { offTerminal, onTerminalReadingAFile } from "../helpers/terminal";

const platform = usePlatformMock();

/**
 * Every command that prints what the server answered, in every way a reader
 * sees it, against a platform answering values that would drive a terminal.
 *
 * @remarks
 * The one cross-command spec, for the same reason `cli.spec.ts` is the other:
 * the assertion *is* the cross-check. Each finding behind this file was the one
 * invariant broken at one more site — an error's message, a list's footer, a
 * list's empty line, a detail view's cells, a JSON body's escape — and each was
 * fixed where it was found, because nothing drove every command through every
 * rendering with something to escape. A per-command spec cannot hold this: it
 * would be the same table copied forty times, and the site that was forgotten
 * is exactly the one nobody thought to copy it to.
 *
 * It asserts the invariants and never success. A command run twice may refuse
 * the second time — an origin already added, a release already built — and a
 * refusal is a rendering too: `renderError` is where this broke first, so a
 * matrix that only accepted successes would have missed it.
 *
 * What each command says, and whether it was right to say it, stays in that
 * command's own spec. This says only that however it says it, a reader's
 * terminal is not driven by it and a script's JSON still parses.
 */

/** A control sequence that clears the screen, as a value the server answers with. */
const DRIVES_A_TERMINAL = "\u001b[2J";

/**
 * Which answer a command is given to print. One at a time: registering every
 * hostile answer at once shadows a handler another part of a command needs,
 * which fails as an unmocked request rather than as anything about rendering.
 */
const HOSTILE = {
  origin: (): void => {
    platform.servesAHostileOrigin();
  },
  release: (): void => {
    platform.revokesAHostileReleaseId();
  },
  cursor: (): void => {
    platform.pagesWithAHostileCursor();
  },
  none: (): void => {},
} as const;

/** What a command needs before it can say anything, and the args to say it with. */
type Driven = {
  readonly args: readonly string[];
  /** The answer this command is given to print. The origin unless it reads another. */
  readonly hostile?: keyof typeof HOSTILE;
  /** Run once per command, before any rendering of it. */
  readonly arrange?: (app: ScaffoldedApp) => Promise<void>;
  /** Args only the arranged project can supply, such as a deployment's id. */
  readonly lateArgs?: (app: ScaffoldedApp) => Promise<readonly string[]>;
  /** Piped in, for a command that takes a secret that way rather than in argv. */
  readonly stdin?: string;
};

/** The deployment the `deployment get` row arranged, for its own args. */
let deployed = "";

/** The release a row arranged, likewise. */
let released = "";

/** A project with an origin to land on. */
const withAnOrigin = async (app: ScaffoldedApp): Promise<void> => {
  await app.addPrimaryOrigin();
};

/** A project with an origin, a variable and a deployment that froze it. */
const withADeployment = async (app: ScaffoldedApp): Promise<void> => {
  await app.addPrimaryOrigin();
  await app.setVariable("HOST", "app.acme.com");
  await app.deployData();
};

/**
 * Every command whose output can carry what the server answered.
 *
 * Left out, each owned by its own spec: the ones that print only what the
 * machine holds (`start`, `stop`, `reset`, `console`, `eject`, `uninstall`),
 * the ones that ask a person questions (`setup`, `claim`), the one that reaches
 * the registry (`upgrade`), and the three whose harness is their own —
 * `doctor` needs a Docker on `PATH`, `logs` a started runtime, `preview` a
 * pull-request build's credential. The resource commands come from one factory,
 * which `resources.spec.ts` and the factory's unit tests cover.
 */
const COMMANDS: ReadonlyArray<readonly [string, Driven]> = [
  ["origin list", { args: ["origin", "list"], arrange: withAnOrigin }],
  ["origin add", { args: ["origin", "add", "https://added.example.com", "--kind", "primary"] }],
  [
    "origin rm",
    { args: ["origin", "rm", "https://app.example.com", "--force"], arrange: withAnOrigin },
  ],
  ["variable list", { args: ["variable", "list"], arrange: withADeployment }],
  ["variable get", { args: ["variable", "get", "HOST"], arrange: withADeployment }],
  ["variable set", { args: ["variable", "set", "SET_BY_MATRIX", "a-value"] }],
  ["variable rm", { args: ["variable", "rm", "HOST", "--force"], arrange: withADeployment }],
  ["variable resolve", { args: ["variable", "resolve"], arrange: withADeployment }],
  ["deployment list", { args: ["deployment", "list"], arrange: withADeployment }],
  [
    "deployment get",
    {
      args: ["deployment", "get"],
      arrange: async (app) => {
        await app.addPrimaryOrigin();
        await app.setVariable("HOST", "app.acme.com");
        deployed = (await app.deployData()).deployment_id ?? "";
      },
      lateArgs: () => {
        return Promise.resolve([deployed]);
      },
    },
  ],
  [
    "deployment rollback",
    { args: ["deployment", "rollback", "--force"], arrange: withADeployment },
  ],
  ["preview list", { args: ["preview", "list"], arrange: withAnOrigin }],
  ["preview rm", { args: ["preview", "rm", "https://pr-1.preview.example.com", "--force"] }],
  ["release create", { args: ["release", "create", "-m", "from the matrix"] }],
  [
    "release revoke",
    {
      args: ["release", "revoke", "--force"],
      hostile: "release",
      arrange: async (app) => {
        await app.addPrimaryOrigin();
        released = (await app.deployData()).release_id ?? "";
      },
      lateArgs: () => {
        return Promise.resolve([released]);
      },
    },
  ],
  [
    "deployment create",
    {
      args: ["deployment", "create", "--release"],
      arrange: async (app) => {
        await app.addPrimaryOrigin();
        released = (await app.deployData()).release_id ?? "";
      },
      lateArgs: () => {
        return Promise.resolve([released]);
      },
    },
  ],
  ["branding eject", { args: ["branding", "eject", "--design", "clean"] }],
  ["env add", { args: ["env", "add", "staging"] }],
  ["pull", { args: ["pull"], arrange: withADeployment }],
  ["deploy", { args: ["deploy", "-m", "from the matrix"], arrange: withAnOrigin }],
  ["env", { args: ["env"] }],
  ["env list", { args: ["env", "list"] }],
  ["api", { args: ["api", "getVariables"], arrange: withADeployment }],
  ["api ls", { args: ["api", "ls"] }],
  ["policies test", { args: ["policies", "test"] }],
  ["status", { args: ["status"] }],
  ["skills add", { args: ["skills", "add"] }],
  ["resources", { args: ["resources"] }],
  ["auth-method password disable", { args: ["auth-method", "password", "disable", "--force"] }],
  ["auth-method passkey enable", { args: ["auth-method", "passkey", "enable"] }],
  ["auth-method passkey disable", { args: ["auth-method", "passkey", "disable", "--force"] }],
  ["auth-method password enable", { args: ["auth-method", "password", "enable"] }],
  [
    "auth-method sso enable",
    {
      args: [
        "auth-method",
        "sso",
        "enable",
        "--non-interactive",
        "--provider",
        "google",
        "--client-id",
        "1234-abc.apps.googleusercontent.com",
      ],
      stdin: "the-client-secret",
    },
  ],
  [
    "auth-method sso disable",
    { args: ["auth-method", "sso", "disable", "--provider", "google", "--force"] },
  ],
];

/** Every way a reader sees the same run. */
const WAYS = [
  ["as a script reads it", { json: true, terminal: false, env: {} }],
  ["piped", { json: false, terminal: false, env: {} }],
  // Output on a screen with the input a file, as a run in CI with a terminal
  // attached has: a command that would ask a question fails fast instead of
  // waiting for an answer no test can give.
  ["on a terminal, in colour", { json: false, terminal: true, env: { FORCE_COLOR: "1" } }],
  ["on a terminal, without colour", { json: false, terminal: true, env: { NO_COLOR: "1" } }],
] as const;

/** Each command paired with each way of reading it. */
const GRID = COMMANDS.flatMap(([name, driven]) => {
  return WAYS.map(([how, way]) => {
    return [`${name}, ${how}`, driven, way] as const;
  });
});

describe("every command's renderings", () => {
  describe("against a platform answering what would drive a terminal", () => {
    it.each(GRID)("%s", async (_name, driven, way) => {
      const app = await aSetUpApp();
      await driven.arrange?.(app);
      HOSTILE[driven.hostile ?? "origin"]();
      const args = [...driven.args, ...((await driven.lateArgs?.(app)) ?? [])];

      // The fixture holds every run to the invariants: nothing on either
      // stream may drive the reader's terminal, and a JSON object on stdout
      // must parse. Running the grid is what puts them to each rendering.
      const run = (): Promise<{ stdout: string; stderr: string }> => {
        const argv = way.json ? [...args, "--json"] : args;
        return driven.stdin === undefined
          ? app.run(argv, way.env)
          : app.pipingStdin(driven.stdin, () => app.run(argv, way.env));
      };
      const result = await (way.terminal ? onTerminalReadingAFile(run) : offTerminal(run));

      // A row that names no command, or names it wrongly, would otherwise pass
      // every rendering but the one the envelope is checked in.
      expect(result.stdout + result.stderr).not.toContain("is not a zitadel command");
      expect(result.stdout + result.stderr).not.toContain(DRIVES_A_TERMINAL);
    });
  });
});
