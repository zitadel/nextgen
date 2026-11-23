import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Args, Command, Flags } from "@oclif/core";
import { describe, expect } from "vitest";

import { Input, inputFlag } from "@/lib/oclif/input";
import { test as it } from "@tests/fixtures";
import { asTerminal } from "@tests/fixtures/terminal";

/**
 * A command declaring one of each kind of flag and two arguments, to read documents against.
 */
class Declaring extends Command {
  static override enableJsonFlag = true;
  static override args = {
    name: Args.string(),
    value: Args.string(),
  };
  static override baseFlags = { cwd: Flags.string({ char: "c" }) };
  static override flags = {
    input: inputFlag,
    "given-name": Flags.string({
      char: "g",
      aliases: ["first"],
    }),
    fields: Flags.string({ delimiter: "," }),
    env: Flags.string({ char: "e" }),
    limit: Flags.integer(),
    set: Flags.string({ multiple: true }),
    tag: Flags.string({
      multiple: true,
      multipleNonGreedy: true,
    }),
    force: Flags.boolean({ allowNo: true }),
    quiet: Flags.boolean({ char: "q" }),
  };

  /**
   * Never run: the class only carries declarations.
   *
   * @returns Nothing, at once.
   */
  public run(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * A command that takes words beyond its declared argument.
 */
class Loose extends Command {
  static override enableJsonFlag = true;
  static override strict = false;
  static override args = { name: Args.string() };
  static override flags = Declaring.flags;

  /**
   * Never run: the class only carries declarations.
   *
   * @returns Nothing, at once.
   */
  public run(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * The words the hook leaves for a line and a document given inline.
 *
 * @param argv - The line as typed.
 * @returns The words after the document is laid under it.
 */
async function expanded(argv: string[]): Promise<readonly string[]> {
  return new Input(Declaring).rewrite(argv);
}

describe("Input", () => {
  describe("expand", () => {
    it("leaves a line with no document as it was", async () => {
      expect(await expanded(["a", "--limit", "2"])).toEqual(["a", "--limit", "2"]);
    });

    it("turns the keys into the flags they name", async () => {
      const words = await expanded(["--input", '{"limit":3,"given-name":"Ada"}']);

      expect(words).toEqual(["--limit=3", "--given-name=Ada"]);
    });

    it.each(["given_name", "givenName", "given-name", "first"])(
      "reaches --given-name as %s",
      async (key) => {
        expect(await expanded(["--input", JSON.stringify({ [key]: "Ada" })])).toEqual([
          "--given-name=Ada",
        ]);
      },
    );

    it.each(["--input", "--flags-file", "--cli-input-json"])(
      "takes the document under %s",
      async (name) => {
        expect(await expanded([name, '{"quiet":true}'])).toEqual(["--quiet"]);
      },
    );

    it("takes the document as --input=<json>", async () => {
      expect(await expanded(['--input={"quiet":true}'])).toEqual(["--quiet"]);
    });

    it("repeats a list flag once for each value", async () => {
      expect(await expanded(["--input", '{"set":["a=1","b=2"]}'])).toEqual([
        "--set=a=1",
        "--set=b=2",
      ]);
    });

    it("joins a list for a flag that declares a delimiter", async () => {
      expect(await expanded(["--input", '{"fields":["id","method"]}'])).toEqual([
        "--fields=id,method",
      ]);
    });

    it("writes an object as the JSON it is", async () => {
      expect(await expanded(["--input", '{"set":[{"a":1}]}'])).toEqual(['--set={"a":1}']);
    });

    it("gives a flag that is off its --no- form when it has one, and nothing when it has none", async () => {
      expect(await expanded(["--input", '{"force":false,"quiet":false}'])).toEqual(["--no-force"]);
    });

    it("leaves a null out", async () => {
      expect(await expanded(["--input", '{"limit":null}'])).toEqual([]);
    });

    it("reads --json from the document", async () => {
      expect(await expanded(["--input", '{"json":true}'])).toEqual(["--json"]);
    });

    it("gives the arguments after a --, by name, from args", async () => {
      expect(await expanded(["--input", '{"args":{"name":"n","value":"v"}}'])).toEqual([
        "--",
        "n",
        "v",
      ]);
    });

    it("gives the arguments in order, from a list", async () => {
      expect(await expanded(["--input", '{"args":["n","v"]}'])).toEqual(["--", "n", "v"]);
    });

    it("takes a key that names an argument as that argument", async () => {
      expect(await expanded(["--input", '{"name":"n","value":"v"}'])).toEqual(["--", "n", "v"]);
    });

    it.each(["-x", "--quiet", "--input"])("keeps an argument of %s an argument", async (value) => {
      expect(await expanded(["--input", JSON.stringify({ args: [value] })])).toEqual(["--", value]);
    });

    it("puts the flags before the arguments", async () => {
      expect(await expanded(["--input", '{"args":["n"],"limit":2}'])).toEqual([
        "--limit=2",
        "--",
        "n",
      ]);
    });

    it.each([
      ["a long form", ["--cwd", "/x"]],
      ["an inline value", ["--cwd=/x"]],
      ["a short form", ["-c", "/x"]],
      ["a short form with its value attached", ["-c/x"]],
    ])("keeps the global flag the line gave as %s", async (_how, typed) => {
      expect(await expanded([...typed, "--input", '{"limit":3}'])).toEqual([
        "--cwd=/x",
        "--limit=3",
      ]);
    });

    it("keeps --json", async () => {
      expect(await expanded(["--json", "--input", '{"limit":3}'])).toEqual(["--json", "--limit=3"]);
    });

    it.each([
      ["a long form", ["--env", "production"]],
      ["a short form", ["-e", "production"]],
    ])("keeps the environment flag the line gave as %s", async (_how, typed) => {
      expect(await expanded([...typed, "--input", '{"limit":3}'])).toEqual([
        "--env=production",
        "--limit=3",
      ]);
    });

    it.each([
      ["a list", '{"args":[["a"]]}'],
      ["an object", '{"args":[{"a":1}]}'],
      ["a named list", '{"args":{"name":["a"]}}'],
    ])("refuses an argument that is %s, where an argument is one word", async (_what, document) => {
      await expect(new Input(Declaring).verify(document)).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("one word"),
      });
    });

    it("leaves a null out of the words a command that takes more is given", async () => {
      const words = await new Input(Loose).rewrite(["--input", '{"args":["op",null,"usr_1"]}']);

      expect(words).toEqual(["--", "op", "usr_1"]);
    });

    it("keeps a file that is no JSON as a JSON string, for the flag to refuse", async ({ dir }) => {
      const path = join(dir, "text.json");
      await writeFile(path, "abc");

      const words = await expanded(["--input", path]);

      expect(words).toEqual(['--input="abc"']);
      await expect(new Input(Declaring).verify('"abc"')).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("JSON object"),
      });
    });

    it("does not repeat a global flag the line gave", async () => {
      expect(await expanded(["--json", "--input", '{"json":true,"limit":1}'])).toEqual([
        "--json",
        "--limit=1",
      ]);
    });

    it.each([
      ["a flag", ["--limit", "2"], ["--limit=2"]],
      ["a short flag", ["-q"], ["--quiet"]],
      ["a flag with its value attached", ["-g=Bo"], ["--given-name=Bo"]],
      ["an argument", ["typed"], ["typed"]],
    ])("refuses %s beside the document", async (_what, typed, shown) => {
      const words = await expanded([...typed, "--input", '{"limit":1}']);

      expect(words).toEqual([...shown, '--input={"limit":1}']);
      await expect(new Input(Declaring).verify('{"limit":1}', words)).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("the whole invocation"),
      });
    });

    it("takes an argument named with an underscore at the top level, in any spelling", async () => {
      class Underscored extends Command {
        static override args = { deployment_id: Args.string() };
        static override flags = { input: inputFlag };

        public run(): Promise<void> {
          return Promise.resolve();
        }
      }

      for (const key of ["deployment_id", "deploymentId", "deployment-id"]) {
        expect(
          await new Input(Underscored).rewrite(["--input", JSON.stringify({ [key]: "dep_1" })]),
        ).toEqual(["--", "dep_1"]);
      }
    });

    it("holds nothing of a line oclif cannot parse, whatever stands beside the document", async () => {
      const words = ["--input", '{"limit":1}', "--bogus"];

      expect(await expanded(words)).toEqual(words);
      await expect(new Input(Declaring).verify('{"limit":1}', words)).resolves.toBeUndefined();
    });

    it("keeps --json for a document it cannot use, so the refusal is the envelope", async () => {
      const document = '{"json":true,"nope":1}';

      expect(await expanded(["--input", document])).toEqual(["--json", `--input=${document}`]);
    });

    it("reads nothing after a --, which is plain values", async () => {
      expect(await expanded(["--json", "--", "--input", '{"args":["A"]}'])).toEqual([
        "--json",
        "--",
        "--input",
        '{"args":["A"]}',
      ]);
    });

    it("refuses words after a -- beside a document", async () => {
      const words = await expanded(["--input", '{"quiet":true}', "--", "--limit", "1"]);

      expect(words).toEqual(["--limit", "1", '--input={"quiet":true}']);
    });

    it("leaves a line holding two documents to the command's own parse", async () => {
      const line = ["--input", '{"limit":1}', "--flags-file", '{"limit":2}'];

      expect(await expanded(line)).toEqual(line);
    });

    it("reads a file, with or without @", async ({ dir }) => {
      const path = join(dir, "in.json");
      await writeFile(path, '{"limit":5}');

      expect(await expanded(["--input", path])).toEqual(["--limit=5"]);
      expect(await expanded(["--input", `@${path}`])).toEqual(["--limit=5"]);
      expect(await expanded(["--cli-input-json", `file://${path}`])).toEqual(["--limit=5"]);
    });

    it("leaves a line with two documents as it was, for the flag to refuse", async () => {
      const line = ["--input", '{"limit":1}', "--input", '{"limit":2}'];

      expect(await expanded(line)).toEqual(line);
    });

    it("reads a file that starts with a byte-order mark", async ({ dir }) => {
      const path = join(dir, "bom.json");
      await writeFile(path, '\uFEFF{"limit":5}');

      expect(await expanded(["--input", path])).toEqual(["--limit=5"]);
    });

    it("refuses - when stdin is a terminal, saying nothing is piped in", async () => {
      const refused = asTerminal(() => {
        return new Input(Declaring).verify("-");
      });

      await expect(refused).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("nothing is piped in"),
      });
    });

    it.for([
      { what: "nothing", piped: "" },
      { what: "only whitespace", piped: " \n" },
    ])("refuses - when $what is piped in", async (row, { terminal }) => {
      terminal.stdin(row.piped);

      const refused = new Input(Declaring).verify("-");

      await expect(refused).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("nothing is piped in"),
      });
    });

    it("reads a document piped in that starts with a byte-order mark", async ({ terminal }) => {
      terminal.stdin('\uFEFF{"limit":5}');

      const words = await expanded(["--input", "-"]);

      expect(words).toEqual(["--limit=5"]);
    });

    it("refuses text that is not JSON, saying so", async () => {
      await expect(new Input(Declaring).verify("{bad")).rejects.toThrow(
        "--input is not valid JSON",
      );
    });

    it.each(["server", "env", "env-file", "cwd"])(
      "refuses %s in a document, which only the command line may set",
      async (key) => {
        const Pointing = class extends Command {
          static override baseFlags = {
            cwd: Flags.string(),
            server: Flags.string(),
            env: Flags.string(),
            "env-file": Flags.string(),
          };
          static override flags = { input: inputFlag };

          public run(): Promise<void> {
            return Promise.resolve();
          }
        };

        await expect(new Input(Pointing).verify(JSON.stringify({ [key]: "x" }))).rejects.toThrow(
          "points the command at a server or project",
        );
      },
    );

    it("never echoes the text of a document that is not JSON", async ({ dir }) => {
      const path = join(dir, "secret.json");
      await writeFile(path, '{"password": sk_live_ABCDEFGH1234567890 secret');

      await expect(new Input(Declaring).verify(path)).rejects.toThrow(/not valid JSON$/u);
    });

    it("refuses a path that is not a regular file", async ({ dir }) => {
      await expect(new Input(Declaring).verify(dir)).rejects.toThrow("not a regular file");
    });

    it("treats a __proto__ argument as an argument the command lacks", async () => {
      await expect(
        new Input(Declaring).verify('{"args":{"__proto__":{"name":"x"}}}'),
      ).rejects.toThrow("which this command lacks");
    });

    it("refuses an empty document, saying it is empty", async () => {
      await expect(new Input(Declaring).verify("  ")).rejects.toThrow("--input is empty");
    });

    it.each([
      ["a key no flag or argument has", '{"nope":1}', "no flag of this command"],
      ["an argument the command lacks", '{"args":{"nope":1}}', "which this command lacks"],
      ["text that is no JSON object", "[1]", "JSON object"],
      ["a bare null", "null", "JSON object"],
      ["a bare string", '"text"', "JSON object"],
      ["a list for a flag with one value", '{"limit":[1]}', "takes one value"],
      ["a number for a boolean flag", '{"quiet":1}', "true or false"],
      ["args that is a string", '{"args":"x"}', "neither an object nor a list"],
      ["the input flag itself", '{"input":"{}"}', "no flag of this command"],
      ["an argument after one left out", '{"args":{"value":"v"}}', "but not"],
    ])(
      "keeps %s on the line as the document, for the flag to refuse",
      async (_what, document, reason) => {
        const words = await expanded(["--input", document]);

        expect(words).toEqual([`--input=${document}`]);
        await expect(new Input(Declaring).verify(document)).rejects.toMatchObject({
          code: "E_VALIDATION",
          message: expect.stringContaining(reason),
        });
      },
    );

    it("leaves a path that is not there on the line, and refuses it as unreadable", async () => {
      expect(await expanded(["--input", "/no/such/in.json"])).toEqual([
        "--input",
        "/no/such/in.json",
      ]);
      await expect(new Input(Declaring).verify("/no/such/in.json")).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("cannot read /no/such/in.json"),
      });
    });

    it("appends the words past the declared arguments for a command that takes more", async () => {
      const words = await new Input(Loose).rewrite(["--input", '{"args":["op","usr_1"]}']);

      expect(words).toEqual(["--", "op", "usr_1"]);
    });
  });
});
