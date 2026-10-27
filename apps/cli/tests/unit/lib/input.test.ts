import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Readable } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
  text: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  multiselect: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

import { cancel, confirm, isCancel, multiselect, password, select, text } from "@clack/prompts";
import { type Parsed, parseClientId } from "@zitadel/config/idp";

import type { ZitadelError } from "../../../src/lib/errors";

import { clackInputImports } from "../../helpers/drawing-boundary";
import { sourceFiles } from "../../helpers/source-files";
import { asker, type Session } from "../../../src/lib/input";
import { unscopedCommand } from "../../../src/lib/suggestion";

const SRC = join(import.meta.dirname, "../../../src");

/** A stdin that is a pipe carrying `content`. */
function piped(content: string): NodeJS.ReadableStream & { isTTY?: boolean } {
  return Object.assign(Readable.from([content]), { isTTY: false });
}

/** A stdin that is the keyboard: reading it would block forever. */
function keyboard(): NodeJS.ReadableStream & { isTTY?: boolean } {
  const stream = Object.assign(Readable.from([]), { isTTY: true });
  stream.read = () => {
    throw new Error("a terminal on stdin was read");
  };
  return stream;
}

const upper = (value: string): Parsed<string> =>
  value.trim() === ""
    ? { ok: false, problem: "Enter a value." }
    : { ok: true, value: value.toUpperCase() };

const refuseBad = (value: string): Parsed<string> =>
  value === "bad" ? { ok: false, problem: "Not that one." } : { ok: true, value };

const ask: Session = { interactive: true, force: false };
const scripted: Session = { interactive: false, force: false };

const typed = (name = "client id") => ({ name, message: "Client ID", parse: parseClientId });

const options = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
];

beforeEach(() => {
  vi.mocked(text).mockReset();
  vi.mocked(password).mockReset();
  vi.mocked(select).mockReset();
  vi.mocked(multiselect).mockReset();
  vi.mocked(confirm).mockReset();
  vi.mocked(cancel).mockReset();
  vi.mocked(isCancel).mockReset();
  vi.mocked(isCancel).mockReturnValue(false);
});

describe("asker", () => {
  describe("the order of sources", () => {
    it("prefers the given value to piped stdin", async () => {
      const answer = await asker({ ...scripted, stdin: piped("pipe") }).text({
        name: "value",
        message: "Value",
        parse: upper,
        given: "flag",
        stdin: true,
      });

      expect(answer).toBe("FLAG");
    });

    it("prefers piped stdin to a prompt", async () => {
      const answer = await asker({ ...ask, stdin: piped("pipe\n") }).text({
        name: "value",
        message: "Value",
        parse: upper,
        stdin: true,
      });

      expect(answer).toBe("PIPE");
      expect(text).not.toHaveBeenCalled();
    });

    it("prefers the given value to a prompt", async () => {
      await asker(ask).text({ ...typed(), given: "abc" });

      expect(text).not.toHaveBeenCalled();
    });

    it("prompts when nothing else answered and a person is there", async () => {
      vi.mocked(text).mockResolvedValueOnce("typed" as never);

      const answer = await asker(ask).text({ ...typed(), parse: upper });

      expect(answer).toBe("TYPED");
    });

    it("does not read stdin when the question does not accept it", async () => {
      await expect(
        asker({ ...scripted, stdin: piped("pipe") }).text({ ...typed(), parse: upper }),
      ).rejects.toMatchObject({ code: "E_VALIDATION", message: "No client id supplied" });
    });

    it("does not read a terminal on stdin", async () => {
      await expect(
        asker({ ...scripted, stdin: keyboard() }).text({ ...typed(), stdin: true }),
      ).rejects.toMatchObject({ message: "No client id supplied" });
    });

    it("keeps an empty pipe as a value for parse to judge", async () => {
      const answer = await asker({ ...scripted, stdin: piped("") }).text({
        name: "value",
        message: "Value",
        stdin: true,
        parse: (value): Parsed<string> => ({ ok: true, value }),
      });

      expect(answer).toBe("");
    });
  });

  describe("parse", () => {
    it.each([
      ["a flag", { given: "  abc  " }, scripted],
      ["a pipe", { stdin: true }, { ...scripted, stdin: piped("  abc  \n") }],
    ])(
      "runs on the value from %s and returns what it produced",
      async (_source, extra, session) => {
        const answer = await asker(session).text({ ...typed(), ...extra });

        expect(answer).toBe("abc");
      },
    );

    it("runs on what was typed and returns what it produced", async () => {
      vi.mocked(text).mockResolvedValueOnce("  abc  " as never);

      const answer = await asker(ask).text(typed());

      expect(answer).toBe("abc");
    });

    it.each([
      ["a flag", { given: "bad" }, scripted],
      ["a pipe", { stdin: true }, { ...scripted, stdin: piped("bad\n") }],
    ])(
      "refuses a value from %s that does not parse, saying why",
      async (_source, extra, session) => {
        await expect(
          asker(session).text({ ...typed(), parse: refuseBad, ...extra }),
        ).rejects.toMatchObject({ code: "E_VALIDATION", message: "Not that one." });
      },
    );

    it("treats an empty pipe that does not parse as nothing supplied", async () => {
      await expect(
        asker({ ...scripted, stdin: piped("\n") }).text({ ...typed(), stdin: true }),
      ).rejects.toMatchObject({ message: "No client id supplied" });
    });

    it("is what refuses an answer as it is typed", async () => {
      vi.mocked(text).mockResolvedValueOnce("x" as never);

      await asker(ask).text(typed());

      const validate = vi.mocked(text).mock.calls[0]?.[0]?.validate as
        | ((value: string | undefined) => string | undefined)
        | undefined;
      expect(validate?.("")).toBe("Enter the client id.");
      expect(validate?.(undefined)).toBe("Enter the client id.");
      expect(validate?.("x")).toBeUndefined();
    });

    it("shows the placeholder in the prompt", async () => {
      vi.mocked(text).mockResolvedValueOnce("x" as never);

      await asker(ask).text({ ...typed(), placeholder: "3000" });

      expect(vi.mocked(text).mock.calls[0]?.[0]).toMatchObject({ placeholder: "3000" });
    });

    it("starts the prompt from the initial value", async () => {
      vi.mocked(text).mockResolvedValueOnce("x" as never);

      await asker(ask).text({ ...typed(), initialValue: "https://a.example" });

      expect(vi.mocked(text).mock.calls[0]?.[0]).toMatchObject({
        initialValue: "https://a.example",
      });
    });
  });

  describe("a secret", () => {
    it("is typed into a masked prompt", async () => {
      vi.mocked(password).mockResolvedValueOnce("s3cret" as never);

      const answer = await asker(ask).secret(typed("client secret"));

      expect(answer).toBe("s3cret");
      expect(text).not.toHaveBeenCalled();
    });

    it("is never put in the error for a value that does not parse", async () => {
      const error = await asker({ ...scripted, stdin: piped("hunter2") })
        .secret({
          name: "client secret",
          message: "Secret",
          stdin: true,
          retry: unscopedCommand("x"),
          parse: (): Parsed<string> => ({ ok: false, problem: "Too short." }),
        })
        .catch((caught: ZitadelError) => caught);

      const { message, hint, details, nextCommands } = error as ZitadelError;
      expect(JSON.stringify({ message, hint, details, nextCommands })).not.toContain("hunter2");
    });

    it("is refused with a reminder that it is never a flag", async () => {
      const error = await asker({ ...scripted, stdin: keyboard() })
        .secret({ ...typed("client secret"), stdin: true })
        .catch((caught: ZitadelError) => caught);

      expect((error as ZitadelError).hint).toContain("It is never a flag");
    });
  });

  describe("with nothing supplied and nobody to ask", () => {
    it.each([
      ["no flag and no stdin", {}, "No client id supplied", undefined],
      ["a flag", { flag: "--client-id" }, "No client id supplied", "Pass --client-id."],
      ["stdin", { stdin: true }, "No client id supplied", "Pipe it in on stdin."],
      [
        "a flag and stdin",
        { flag: "--client-id", stdin: true },
        "No client id supplied",
        "Pass --client-id, or pipe it in on stdin.",
      ],
    ])("says what to do given %s", async (_case, extra, message, hint) => {
      await expect(
        asker({ ...scripted, stdin: keyboard() }).text({ ...typed(), ...extra }),
      ).rejects.toMatchObject({ code: "E_VALIDATION", message, hint });
    });

    it("says a secret is never a flag", async () => {
      await expect(
        asker({ ...scripted, stdin: keyboard() }).secret({
          ...typed("client secret"),
          stdin: true,
        }),
      ).rejects.toMatchObject({ hint: expect.stringContaining("It is never a flag") });
    });

    it("offers the command to run again as the next command", async () => {
      await expect(
        asker(scripted).text({
          ...typed(),
          retry: unscopedCommand("auth-method sso enable --client-id <id>"),
        }),
      ).rejects.toMatchObject({
        nextCommands: ["zitadel auth-method sso enable --client-id <id>"],
      });
    });

    it("quotes the command to run again in the hint as an example", async () => {
      await expect(
        asker(scripted).text({
          ...typed(),
          retry: unscopedCommand("auth-method sso enable --client-id <id>"),
        }),
      ).rejects.toMatchObject({
        hint: "For example: zitadel auth-method sso enable --client-id <id>",
      });
    });

    it.each([
      ["a select", "select" as const],
      ["a multiselect", "multiselect" as const],
    ])("offers the command to run again for %s too", async (_kind, method) => {
      await expect(
        asker(scripted)[method]({
          name: "x",
          message: "X",
          retry: unscopedCommand("x --y"),
          options,
        }),
      ).rejects.toMatchObject({ nextCommands: ["zitadel x --y"] });
    });

    it.each([
      ["a select", "select" as const],
      ["a multiselect", "multiselect" as const],
    ])("refuses %s the same way", async (_kind, method) => {
      await expect(
        asker(scripted)[method]({
          name: "framework",
          message: "Framework",
          flag: "--framework",
          options,
        }),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: "No framework supplied",
        hint: "Pass --framework.",
      });
    });
  });

  describe("an optional value", () => {
    const optional = { ...typed("client secret"), stdin: true, optional: true as const };

    it("is returned when piped in", async () => {
      expect(await asker({ ...scripted, stdin: piped("abc\n") }).secret(optional)).toBe("abc");
    });

    it("is undefined when nothing was piped in", async () => {
      expect(await asker({ ...scripted, stdin: keyboard() }).secret(optional)).toBeUndefined();
    });

    it("is undefined when the pipe was empty", async () => {
      expect(await asker({ ...scripted, stdin: piped("\n") }).secret(optional)).toBeUndefined();
    });

    it("is refused when what was piped in does not parse", async () => {
      await expect(
        asker({ ...scripted, stdin: piped("abc") }).secret({
          ...optional,
          parse: (): Parsed<string> => ({ ok: false, problem: "Not that." }),
        }),
      ).rejects.toMatchObject({ code: "E_VALIDATION", message: "Not that." });
    });

    it("is never prompted for", async () => {
      await asker({ ...ask, stdin: keyboard() }).secret(optional);

      expect(password).not.toHaveBeenCalled();
    });
  });

  describe("select", () => {
    it("returns the value of the chosen option", async () => {
      vi.mocked(select).mockResolvedValueOnce("b" as never);

      expect(await asker(ask).select({ name: "x", message: "X", options })).toBe("b");
    });

    it("starts on the initial value", async () => {
      vi.mocked(select).mockResolvedValueOnce("a" as never);

      await asker(ask).select({ name: "x", message: "X", options, initialValue: "b" });

      expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
        message: "X",
        options,
        initialValue: "b",
      });
    });

    it("is never asked when nobody is there", async () => {
      await expect(
        asker(scripted).select({ name: "x", message: "X", options }),
      ).rejects.toMatchObject({ message: "No x supplied" });
      expect(select).not.toHaveBeenCalled();
    });
  });

  describe("multiselect", () => {
    it("returns the values of the chosen options", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["a", "b"] as never);

      expect(await asker(ask).multiselect({ name: "x", message: "X", options })).toEqual([
        "a",
        "b",
      ]);
    });

    it("returns nothing chosen as an empty list", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce([] as never);

      expect(
        await asker(ask).multiselect({ name: "x", message: "X", options, required: false }),
      ).toEqual([]);
    });

    it.each([true, false])("passes required=%s on to the prompt", async (required) => {
      vi.mocked(multiselect).mockResolvedValueOnce([] as never);

      await asker(ask).multiselect({ name: "x", message: "X", options, required });

      expect(vi.mocked(multiselect).mock.calls[0]?.[0]).toMatchObject({ message: "X", required });
    });
  });

  describe("confirm", () => {
    const question = { name: "delete the thing", message: "Delete?" };

    it.each([true, false])("returns %s as answered", async (answer) => {
      vi.mocked(confirm).mockResolvedValueOnce(answer as never);

      expect(await asker(ask).confirm(question)).toBe(answer);
    });

    it("is answered by force, without asking", async () => {
      expect(await asker({ interactive: true, force: true }).confirm(question)).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("is answered by force when nobody is there to ask", async () => {
      expect(await asker({ interactive: false, force: true }).confirm(question)).toBe(true);
    });

    it("defaults to no", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false as never);

      await asker(ask).confirm(question);

      expect(vi.mocked(confirm).mock.calls[0]?.[0]).toMatchObject({ initialValue: false });
    });

    it("requires --force when nobody is there to ask", async () => {
      await expect(
        asker(scripted).confirm({ ...question, retry: unscopedCommand("x --force") }),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: "Cannot delete the thing without --force in non-interactive mode",
        hint: "Pass --force to delete the thing.",
        nextCommands: ["zitadel x --force"],
      });
    });
  });

  describe("cancelling", () => {
    const prompts: Array<[string, () => unknown, () => Promise<unknown>]> = [
      ["a text prompt", () => vi.mocked(text), () => asker(ask).text(typed())],
      ["a secret prompt", () => vi.mocked(password), () => asker(ask).secret(typed())],
      [
        "a select",
        () => vi.mocked(select),
        () => asker(ask).select({ name: "x", message: "X", options }),
      ],
      [
        "a multiselect",
        () => vi.mocked(multiselect),
        () => asker(ask).multiselect({ name: "x", message: "X", options }),
      ],
      [
        "a confirm",
        () => vi.mocked(confirm),
        () => asker(ask).confirm({ name: "x", message: "X" }),
      ],
    ];

    it.each(prompts)("throws E_CANCELLED from %s", async (_kind, prompt, question) => {
      // A cancel is the person's decision, not a value that failed to parse,
      // so it exits 130 like Ctrl-C anywhere else.
      vi.mocked(isCancel).mockReturnValue(true);
      (prompt() as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Symbol("cancel"));

      await expect(question()).rejects.toMatchObject({
        code: "E_CANCELLED",
        exitCode: 130,
        message: "Cancelled by user",
      });
    });

    it.each(prompts)("says so on the terminal from %s", async (_kind, prompt, question) => {
      vi.mocked(isCancel).mockReturnValue(true);
      (prompt() as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Symbol("cancel"));

      await question().catch(() => undefined);

      expect(cancel).toHaveBeenCalledWith("Cancelled.");
    });
  });
});

describe("the source tree", () => {
  // Every prompt behaves the same way only if every prompt is asked the same
  // way, so clack's input prompts are imported in lib/input.ts and nowhere else.
  it("imports clack's input prompts in lib/input.ts only", async () => {
    const importers: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      if (clackInputImports(await readFile(file, "utf8")).length > 0) {
        // Compared with forward slashes, so the test also passes on Windows.
        importers.push(relative(SRC, file).split(sep).join("/"));
      }
    }

    expect(importers).toEqual(["lib/input.ts"]);
  });

  // The typed methods are the whole point: a command names the question it is
  // asking by the method it calls, so there is no kind string left to get
  // wrong. Only `lib/input.ts` writes one, because it is the engine behind all
  // five and the home of the deprecated asker.
  it("names no question by a kind string outside the engine", async () => {
    const tagged: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const source = await readFile(file, "utf8");
      const path = relative(SRC, file).split(sep).join("/");
      if (path !== "lib/input.ts" && /kind: ["'](text|secret|confirm)["']/.test(source)) {
        tagged.push(path);
      }
    }

    // `commands/env/add.ts` is the last caller of the deprecated `this.input`.
    expect(tagged).toEqual(["commands/env/add.ts"]);
  });
});

describe("the boundary scan", () => {
  it.each([
    ["a named import", 'import { text } from "@clack/prompts";', ["text"]],
    ["a single-quoted import", "import { select } from '@clack/prompts';", ["select"]],
    [
      "a multi-line import",
      'import {\n  intro,\n  confirm,\n} from "@clack/prompts";',
      ["confirm"],
    ],
    ["a renamed import", 'import { password as ask } from "@clack/prompts";', ["password"]],
    ["a type-prefixed name", 'import { type isCancel } from "@clack/prompts";', ["isCancel"]],
    ["a type-only import", 'import type { text } from "@clack/prompts";', ["text"]],
    ["a re-export", 'export { multiselect } from "@clack/prompts";', ["multiselect"]],
    ["a namespace import", 'import * as clack from "@clack/prompts";', ["*"]],
    ["a default import", 'import clack from "@clack/prompts";', ["*"]],
    ["a default and named import", 'import clack, { spinner } from "@clack/prompts";', ["*"]],
    ["an export-star", 'export * from "@clack/prompts";', ["*"]],
    ["a dynamic import", 'const clack = await import("@clack/prompts");', ["*"]],
    ["a require", "const clack = require('@clack/prompts');", ["*"]],
    ["a name nobody listed", 'import { autocomplete } from "@clack/prompts";', ["autocomplete"]],
  ])("catches %s", (_form, source, expected) => {
    expect(clackInputImports(source)).toEqual(expected);
  });

  it.each(["spinner", "note", "intro", "outro", "log"])("allows %s, which is output", (name) => {
    expect(clackInputImports(`import { ${name} } from "@clack/prompts";`)).toEqual([]);
  });

  it("ignores another package", () => {
    expect(clackInputImports('import { text } from "@clack/core";')).toEqual([]);
  });
});
