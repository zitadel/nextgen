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

import { clackInputImports } from "../../helpers/clack-imports";
import { sourceFiles } from "../../helpers/source-files";
import { input } from "../../../src/lib/input";
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

const ask = { interactive: true, force: false };
const scripted = { interactive: false, force: false };

const typed = (name = "client id") => ({
  kind: "text" as const,
  name,
  message: "Client ID",
  parse: parseClientId,
});

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

describe("input", () => {
  describe("the order of sources", () => {
    it("prefers the given value to piped stdin", async () => {
      const answer = await input(
        { kind: "text", name: "value", message: "Value", parse: upper, given: "flag", stdin: true },
        { ...scripted, stdin: piped("pipe") },
      );

      expect(answer).toBe("FLAG");
    });

    it("prefers piped stdin to a prompt", async () => {
      const answer = await input(
        { kind: "text", name: "value", message: "Value", parse: upper, stdin: true },
        { ...ask, stdin: piped("pipe\n") },
      );

      expect(answer).toBe("PIPE");
      expect(text).not.toHaveBeenCalled();
    });

    it("prefers the given value to a prompt", async () => {
      await input({ ...typed(), given: "abc" }, ask);

      expect(text).not.toHaveBeenCalled();
    });

    it("prompts when nothing else answered and a person is there", async () => {
      vi.mocked(text).mockResolvedValueOnce("typed" as never);

      const answer = await input({ ...typed(), parse: upper }, ask);

      expect(answer).toBe("TYPED");
    });

    it("does not read stdin when the question does not accept it", async () => {
      await expect(
        input({ ...typed(), parse: upper }, { ...scripted, stdin: piped("pipe") }),
      ).rejects.toMatchObject({ code: "E_VALIDATION", message: "No client id supplied" });
    });

    it("does not read a terminal on stdin", async () => {
      await expect(
        input({ ...typed(), stdin: true }, { ...scripted, stdin: keyboard() }),
      ).rejects.toMatchObject({ message: "No client id supplied" });
    });

    it("keeps an empty pipe as a value for parse to judge", async () => {
      const answer = await input(
        {
          kind: "text",
          name: "value",
          message: "Value",
          stdin: true,
          parse: (value): Parsed<string> => ({ ok: true, value }),
        },
        { ...scripted, stdin: piped("") },
      );

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
        const answer = await input({ ...typed(), ...extra }, session);

        expect(answer).toBe("abc");
      },
    );

    it("runs on what was typed and returns what it produced", async () => {
      vi.mocked(text).mockResolvedValueOnce("  abc  " as never);

      const answer = await input(typed(), ask);

      expect(answer).toBe("abc");
    });

    it.each([
      ["a flag", { given: "bad" }, scripted],
      ["a pipe", { stdin: true }, { ...scripted, stdin: piped("bad\n") }],
    ])(
      "refuses a value from %s that does not parse, saying why",
      async (_source, extra, session) => {
        await expect(
          input({ ...typed(), parse: refuseBad, ...extra }, session),
        ).rejects.toMatchObject({ code: "E_VALIDATION", message: "Not that one." });
      },
    );

    it("treats an empty pipe that does not parse as nothing supplied", async () => {
      await expect(
        input({ ...typed(), stdin: true }, { ...scripted, stdin: piped("\n") }),
      ).rejects.toMatchObject({ message: "No client id supplied" });
    });

    it("is what refuses an answer as it is typed", async () => {
      vi.mocked(text).mockResolvedValueOnce("x" as never);

      await input(typed(), ask);

      const validate = vi.mocked(text).mock.calls[0]?.[0]?.validate as
        | ((value: string | undefined) => string | undefined)
        | undefined;
      expect(validate?.("")).toBe("Enter the client id.");
      expect(validate?.(undefined)).toBe("Enter the client id.");
      expect(validate?.("x")).toBeUndefined();
    });

    it("shows the placeholder in the prompt", async () => {
      vi.mocked(text).mockResolvedValueOnce("x" as never);

      await input({ ...typed(), placeholder: "3000" }, ask);

      expect(vi.mocked(text).mock.calls[0]?.[0]).toMatchObject({ placeholder: "3000" });
    });

    it("starts the prompt from the initial value", async () => {
      vi.mocked(text).mockResolvedValueOnce("x" as never);

      await input({ ...typed(), initialValue: "https://a.example" }, ask);

      expect(vi.mocked(text).mock.calls[0]?.[0]).toMatchObject({
        initialValue: "https://a.example",
      });
    });
  });

  describe("a secret", () => {
    it("is typed into a masked prompt", async () => {
      vi.mocked(password).mockResolvedValueOnce("s3cret" as never);

      const answer = await input({ ...typed("client secret"), kind: "secret" }, ask);

      expect(answer).toBe("s3cret");
      expect(text).not.toHaveBeenCalled();
    });

    it("is never put in the error for a value that does not parse", async () => {
      const error = await input(
        {
          kind: "secret",
          name: "client secret",
          message: "Secret",
          stdin: true,
          retry: unscopedCommand("x"),
          parse: (): Parsed<string> => ({ ok: false, problem: "Too short." }),
        },
        { ...scripted, stdin: piped("hunter2") },
      ).catch((caught: ZitadelError) => caught);

      const { message, hint, details, nextCommands } = error as ZitadelError;
      expect(JSON.stringify({ message, hint, details, nextCommands })).not.toContain("hunter2");
    });

    it("is refused with a reminder that it is never a flag", async () => {
      const error = await input(
        { ...typed("client secret"), kind: "secret", stdin: true },
        { ...scripted, stdin: keyboard() },
      ).catch((caught: ZitadelError) => caught);

      expect((error as ZitadelError).hint).toContain("It is never a flag");
    });

    it("is not offered a flag, even when the question names one", async () => {
      await expect(
        input({ ...typed("client secret"), kind: "secret", flag: "--secret" }, scripted),
      ).rejects.toMatchObject({ hint: expect.not.stringContaining("--secret") });
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
        input({ ...typed(), ...extra }, { ...scripted, stdin: keyboard() }),
      ).rejects.toMatchObject({ code: "E_VALIDATION", message, hint });
    });

    it("says a secret is never a flag", async () => {
      await expect(
        input(
          { ...typed("client secret"), kind: "secret", stdin: true },
          { ...scripted, stdin: keyboard() },
        ),
      ).rejects.toMatchObject({
        hint: expect.stringContaining("It is never a flag"),
      });
    });

    it("offers the command to run again as the next command", async () => {
      await expect(
        input({ ...typed(), retry: unscopedCommand("sso enable --client-id <id>") }, scripted),
      ).rejects.toMatchObject({ nextCommands: ["zitadel sso enable --client-id <id>"] });
    });

    it("quotes the command to run again in the hint as an example", async () => {
      await expect(
        input({ ...typed(), retry: unscopedCommand("sso enable --client-id <id>") }, scripted),
      ).rejects.toMatchObject({
        hint: "For example: zitadel sso enable --client-id <id>",
      });
    });

    it.each([
      ["a select", { kind: "select" as const, options: [{ value: "a", label: "A" }] }],
      ["a multiselect", { kind: "multiselect" as const, options: [{ value: "a", label: "A" }] }],
    ])("offers the command to run again for %s too", async (_kind, extra) => {
      await expect(
        input({ name: "x", message: "X", retry: unscopedCommand("x --y"), ...extra }, scripted),
      ).rejects.toMatchObject({ nextCommands: ["zitadel x --y"] });
    });

    it.each([
      ["a select", { kind: "select" as const, options: [{ value: "a", label: "A" }] }],
      ["a multiselect", { kind: "multiselect" as const, options: [{ value: "a", label: "A" }] }],
    ])("refuses %s the same way", async (_kind, extra) => {
      await expect(
        input({ name: "framework", message: "Framework", flag: "--framework", ...extra }, scripted),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: "No framework supplied",
        hint: "Pass --framework.",
      });
    });
  });

  describe("an optional value", () => {
    const optional = {
      ...typed("client secret"),
      kind: "secret" as const,
      stdin: true,
      optional: true as const,
    };

    it("is returned when piped in", async () => {
      expect(await input(optional, { ...scripted, stdin: piped("abc\n") })).toBe("abc");
    });

    it("is undefined when nothing was piped in", async () => {
      expect(await input(optional, { ...scripted, stdin: keyboard() })).toBeUndefined();
    });

    it("is undefined when the pipe was empty", async () => {
      expect(await input(optional, { ...scripted, stdin: piped("\n") })).toBeUndefined();
    });

    it("is refused when what was piped in does not parse", async () => {
      await expect(
        input(
          { ...optional, parse: (): Parsed<string> => ({ ok: false, problem: "Not that." }) },
          { ...scripted, stdin: piped("abc") },
        ),
      ).rejects.toMatchObject({ code: "E_VALIDATION", message: "Not that." });
    });

    it("is never prompted for", async () => {
      await input(optional, { ...ask, stdin: keyboard() });

      expect(password).not.toHaveBeenCalled();
    });
  });

  describe("select", () => {
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ];

    it("returns the value of the chosen option", async () => {
      vi.mocked(select).mockResolvedValueOnce("b" as never);

      expect(await input({ kind: "select", name: "x", message: "X", options }, ask)).toBe("b");
    });

    it("starts on the initial value", async () => {
      vi.mocked(select).mockResolvedValueOnce("a" as never);

      await input({ kind: "select", name: "x", message: "X", options, initialValue: "b" }, ask);

      expect(vi.mocked(select).mock.calls[0]?.[0]).toMatchObject({
        message: "X",
        options,
        initialValue: "b",
      });
    });

    it("is never asked when nobody is there", async () => {
      await expect(
        input({ kind: "select", name: "x", message: "X", options }, scripted),
      ).rejects.toMatchObject({ message: "No x supplied" });
      expect(select).not.toHaveBeenCalled();
    });
  });

  describe("multiselect", () => {
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ];

    it("returns the values of the chosen options", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce(["a", "b"] as never);

      expect(await input({ kind: "multiselect", name: "x", message: "X", options }, ask)).toEqual([
        "a",
        "b",
      ]);
    });

    it("returns nothing chosen as an empty list", async () => {
      vi.mocked(multiselect).mockResolvedValueOnce([] as never);

      expect(
        await input(
          { kind: "multiselect", name: "x", message: "X", options, required: false },
          ask,
        ),
      ).toEqual([]);
    });

    it.each([true, false])("passes required=%s on to the prompt", async (required) => {
      vi.mocked(multiselect).mockResolvedValueOnce([] as never);

      await input({ kind: "multiselect", name: "x", message: "X", options, required }, ask);

      expect(vi.mocked(multiselect).mock.calls[0]?.[0]).toMatchObject({ message: "X", required });
    });
  });

  describe("confirm", () => {
    const question = { kind: "confirm" as const, name: "delete the thing", message: "Delete?" };

    it.each([true, false])("returns %s as answered", async (answer) => {
      vi.mocked(confirm).mockResolvedValueOnce(answer as never);

      expect(await input(question, ask)).toBe(answer);
    });

    it("is answered by force, without asking", async () => {
      expect(await input(question, { interactive: true, force: true })).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("is answered by force when nobody is there to ask", async () => {
      expect(await input(question, { interactive: false, force: true })).toBe(true);
    });

    it("defaults to no", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false as never);

      await input(question, ask);

      expect(vi.mocked(confirm).mock.calls[0]?.[0]).toMatchObject({ initialValue: false });
    });

    it("requires --force when nobody is there to ask", async () => {
      await expect(
        input({ ...question, retry: unscopedCommand("x --force") }, scripted),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: "Cannot delete the thing without --force in non-interactive mode",
        hint: "Pass --force to delete the thing.",
        nextCommands: ["zitadel x --force"],
      });
    });
  });

  describe("cancelling", () => {
    const prompts: Array<[string, () => unknown, Parameters<typeof input>[0]]> = [
      ["a text prompt", () => vi.mocked(text), typed()],
      ["a secret prompt", () => vi.mocked(password), { ...typed(), kind: "secret" as const }],
      [
        "a select",
        () => vi.mocked(select),
        { kind: "select" as const, name: "x", message: "X", options: [{ value: "a", label: "A" }] },
      ],
      [
        "a multiselect",
        () => vi.mocked(multiselect),
        {
          kind: "multiselect" as const,
          name: "x",
          message: "X",
          options: [{ value: "a", label: "A" }],
        },
      ],
      [
        "a confirm",
        () => vi.mocked(confirm),
        { kind: "confirm" as const, name: "x", message: "X" },
      ],
    ];

    it.each(prompts)("throws E_VALIDATION from %s", async (_kind, prompt, question) => {
      vi.mocked(isCancel).mockReturnValue(true);
      (prompt() as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Symbol("cancel"));

      await expect(input(question, ask)).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: "Cancelled by user",
      });
    });

    it.each(prompts)("says so on the terminal from %s", async (_kind, prompt, question) => {
      vi.mocked(isCancel).mockReturnValue(true);
      (prompt() as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Symbol("cancel"));

      await input(question, ask).catch(() => undefined);

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
