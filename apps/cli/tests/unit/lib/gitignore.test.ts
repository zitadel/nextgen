import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect } from "vitest";

import { brokenRules, entriesToAppend, ZITADEL_GITIGNORE } from "@/lib/gitignore";
import { it } from "@tests/helpers/fixtures";
import { git, ignoredByGit, isolateGit } from "@tests/helpers/git-repo";
import { asAnOlderSetupLeft, SVELTEKIT_GITIGNORE } from "@tests/helpers/gitignore";

/** What `sv create`'s minimal template writes. */
const SVELTEKIT = SVELTEKIT_GITIGNORE;

/** The env lines of the Nuxt starter `nuxi init` extracts. */
const NUXT = "# Local env files\n.env\n.env.*\n!.env.example\n";

/** The whole `.gitignore` of the SolidStart template `create-solid` takes. */
const SOLID_START = ".env\n!.env.example\n";

/** The env lines `create-next-app` writes. */
const NEXT = "# env files (can opt-in for committing if needed)\n.env*\n";

/** What create-vite's templates ignore of env files. */
const VITE = "node_modules\ndist\n*.local\n";

/** What `create-qwik`'s base starter and TanStack's React base ignore of env files. */
const QWIK_ROUTER = ".env\n*.local\n";

/** Angular's workspace template, which ignores no env file. */
const ANGULAR = "/dist\n/node_modules\n";

/** A SvelteKit app an older setup merged into, `.env*` after the generator's `!.env.example`. */
const AN_OLDER_SETUP = asAnOlderSetupLeft(SVELTEKIT);

/** A Vite app this setup has already merged into. */
const ALREADY_SET_UP = `${VITE}.zitadel/secret\n.env*\n!.env.example\n`;

/** A customer's own rules: secrets of their own, an exception before a broad rule, a directory. */
const A_CUSTOMERS_OWN = "*.pem\n/config/secrets/\n!.env.example\n.env*\n!.env.staging\n";

/** Every shape the merge meets: each generator's, an older setup's, a set-up app's, a customer's, none. */
const SHAPES = [
  ["SvelteKit", SVELTEKIT],
  ["Nuxt", NUXT],
  ["SolidStart", SOLID_START],
  ["Next.js", NEXT],
  ["Vite", VITE],
  ["Qwik City", QWIK_ROUTER],
  ["Angular", ANGULAR],
  ["an older setup", AN_OLDER_SETUP],
  ["an app already set up", ALREADY_SET_UP],
  ["a customer's own", A_CUSTOMERS_OWN],
  ["an empty file", ""],
] as const;

/** Shapes whose own lines already ignore every env file setup writes, so the merge needs no `.env*`. */
const SHAPES_COVERING_ENV_FILES = [
  ["SvelteKit", SVELTEKIT],
  ["Nuxt", NUXT],
  ["Next.js", NEXT],
  ["an older setup", AN_OLDER_SETUP],
  ["a customer's own", A_CUSTOMERS_OWN],
] as const;

/** Shapes an older setup left with `.env.example` ignored: the generators that commit it themselves. */
const OLDER_SETUPS = [
  ["SvelteKit", AN_OLDER_SETUP],
  ["Nuxt", asAnOlderSetupLeft(NUXT)],
  ["SolidStart", asAnOlderSetupLeft(SOLID_START)],
] as const;

const RULE_PATHS = ZITADEL_GITIGNORE.map((rule) => {
  return rule.path;
});

const SECRET_PATHS = ZITADEL_GITIGNORE.filter((rule) => {
  return rule.ignored;
}).map((rule) => {
  return rule.path;
});

/** Paths no rule names, which the shapes above decide one way or the other. */
const OTHER_PATHS = [
  ".env.test",
  ".env.staging",
  ".env.production",
  "server.pem",
  "config/secrets/key",
  "src/app.ts",
];

/** The paths of `paths` git ignores once the repository at `dir` has `text` as its `.gitignore`. */
async function ignoredWith(dir: string, text: string, paths: readonly string[]): Promise<string[]> {
  await writeFile(join(dir, ".gitignore"), text);
  return ignoredByGit(dir, paths);
}

/** `text` with `entries` appended on lines of their own, as the file writer appends them. */
function appended(text: string, entries: readonly string[]): string {
  if (entries.length === 0) {
    return text;
  }
  const gap = text === "" || text.endsWith("\n") ? "" : "\n";
  return `${text}${gap}${entries.join("\n")}\n`;
}

beforeEach(async () => {
  isolateGit();
});

describe("entriesToAppend", () => {
  describe.for(SHAPES)("with %s", ([, text]) => {
    it("makes git ignore every file holding a secret and keep .env.example", async ({ dir }) => {
      await git(dir, "init", "--quiet");

      const entries = entriesToAppend(text);

      expect(await ignoredWith(dir, appended(text, entries), RULE_PATHS)).toEqual(SECRET_PATHS);
    });

    it("leaves ignored every path git ignored before", async ({ dir }) => {
      await git(dir, "init", "--quiet");
      const before = await ignoredWith(dir, text, [...SECRET_PATHS, ...OTHER_PATHS]);

      const entries = entriesToAppend(text);

      expect(
        await ignoredWith(dir, appended(text, entries), [...SECRET_PATHS, ...OTHER_PATHS]),
      ).toEqual(expect.arrayContaining(before));
    });

    it("asks for nothing once its entries are appended", () => {
      const once = appended(text, entriesToAppend(text));

      const again = entriesToAppend(once);

      expect(again).toEqual([]);
    });
  });

  describe.for(SHAPES_COVERING_ENV_FILES)(
    "with %s, whose lines cover the env files",
    ([, text]) => {
      it("changes nothing git decides about paths no rule names", async ({ dir }) => {
        await git(dir, "init", "--quiet");
        const before = await ignoredWith(dir, text, OTHER_PATHS);

        const entries = entriesToAppend(text);

        expect(await ignoredWith(dir, appended(text, entries), OTHER_PATHS)).toEqual(before);
      });
    },
  );

  it("asks for nothing when the file already holds every rule", () => {
    const entries = entriesToAppend(ALREADY_SET_UP);

    expect(entries).toEqual([]);
  });

  it("appends after everything the file holds, never inside it", () => {
    const entries = entriesToAppend(AN_OLDER_SETUP);

    expect(appended(AN_OLDER_SETUP, entries).startsWith(AN_OLDER_SETUP)).toBe(true);
  });
});

describe("brokenRules", () => {
  describe.for(OLDER_SETUPS)("with %s as an older setup left it", ([, text]) => {
    it("is a file in which git ignores .env.example", async ({ dir }) => {
      await git(dir, "init", "--quiet");

      const ignored = await ignoredWith(dir, text, [".env.example"]);

      expect(ignored).toEqual([".env.example"]);
    });

    it("names .env.example alone", () => {
      const broken = brokenRules(text);

      expect(
        broken.map((rule) => {
          return rule.path;
        }),
      ).toEqual([".env.example"]);
    });
  });

  it("names every file holding a secret in an empty file", () => {
    const broken = brokenRules("");

    expect(
      broken
        .filter((rule) => {
          return rule.ignored;
        })
        .map((rule) => {
          return rule.path;
        }),
    ).toEqual(SECRET_PATHS);
  });

  it("names nothing in a file that holds every rule", () => {
    const broken = brokenRules(ALREADY_SET_UP);

    expect(broken).toEqual([]);
  });
});
