import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Readable, Writable } from "node:stream";

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
import { typing } from "../../helpers/terminal";
import { sourceFiles } from "../../helpers/source-files";
import { asker, plainAsker, type Session, Swallowing } from "../../../src/lib/input";
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
      expect(validate?.("")).toBe("The client id is empty.");
      expect(validate?.(undefined)).toBe("The client id is empty.");
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

    // The one cancellation word the whole CLI says: this was the only one
    // with a full stop, and the only one clack draws.
    it.each(prompts)("says so on the terminal from %s", async (_kind, prompt, question) => {
      vi.mocked(isCancel).mockReturnValue(true);
      (prompt() as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Symbol("cancel"));

      await question().catch(() => undefined);

      expect(cancel).toHaveBeenCalledWith("Cancelled");
    });
  });
});

describe("plainAsker", () => {
  describe("a text question", () => {
    it("asks it on one line, with the answer typed after it", async () => {
      const talk = typing("https://app.acme.com");

      await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).text({
        name: "origin",
        message: "What URL is your app served from?",
        parse: (value): Parsed<string> => ({ ok: true, value }),
      });

      expect(talk.shown()).toBe("What URL is your app served from? ");
    });

    it("gives back what parse made of the answer", async () => {
      const talk = typing("abc");

      const answer = await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).text(
        typed(),
      );

      expect(answer).toBe("abc");
    });

    it("says why an answer was refused and asks for another", async () => {
      const talk = typing("bad", "good");

      const answer = await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).text({
        ...typed(),
        parse: refuseBad,
      });

      expect(answer).toBe("good");
      expect(talk.shown()).toContain("Not that one.\n");
    });

    it("offers the initial value as the default an empty answer takes", async () => {
      const talk = typing("");

      const answer = await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).text({
        ...typed(),
        initialValue: "abc",
      });

      expect(answer).toBe("abc");
      expect(talk.shown()).toContain("[abc]");
    });

    it("is never asked when a flag already answered it", async () => {
      const talk = typing();

      await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).text({
        ...typed(),
        given: "abc",
      });

      expect(talk.shown()).toBe("");
    });

    it("is never asked when a pipe already answered it", async () => {
      const talk = typing();

      const answer = await plainAsker({
        ...ask,
        stdin: piped("abc\n"),
        stdout: talk.stdout,
      }).text({ ...typed(), stdin: true });

      expect(answer).toBe("abc");
      expect(talk.shown()).toBe("");
    });

    it("refuses by the question's own name with nobody to ask", async () => {
      await expect(
        plainAsker({ ...scripted, stdin: keyboard() }).text({ ...typed(), flag: "--client-id" }),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: "No client id supplied",
        hint: "Pass --client-id.",
      });
    });
  });

  describe("a confirmation", () => {
    const question = { name: "remove the variable", message: "Remove GREETING?" };

    it("spells the default out and reads the answer on the same line", async () => {
      const talk = typing("y");

      const answer = await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).confirm(
        question,
      );

      expect(answer).toBe(true);
      expect(talk.shown()).toBe("Remove GREETING? [y/N] ");
    });

    it.each([
      ["y", true],
      ["yes", true],
      ["Y", true],
      ["n", false],
      ["no", false],
    ])("reads %s as %s", async (typed_, expected) => {
      const talk = typing(typed_);

      expect(
        await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).confirm(question),
      ).toBe(expected);
    });

    it("takes an empty answer as the default", async () => {
      const talk = typing("");

      expect(
        await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).confirm(question),
      ).toBe(false);
    });

    it("shows a default of yes as the one an empty answer takes", async () => {
      const talk = typing("");

      const answer = await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).confirm({
        ...question,
        initialValue: true,
      });

      expect(answer).toBe(true);
      expect(talk.shown()).toContain("[Y/n]");
    });

    it("asks again when the answer is neither", async () => {
      const talk = typing("maybe", "n");

      expect(
        await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).confirm(question),
      ).toBe(false);
      expect(talk.shown()).toContain("Please answer yes or no.\n");
    });

    // The whole point of the two presentations: --force removes the question
    // and changes nothing else, so the command looks the same either way.
    it("is answered by --force without writing anything at all", async () => {
      const talk = typing();

      const answer = await plainAsker({
        ...ask,
        force: true,
        stdin: talk.stdin,
        stdout: talk.stdout,
      }).confirm(question);

      expect(answer).toBe(true);
      expect(talk.shown()).toBe("");
    });

    it("still requires --force with nobody to ask", async () => {
      await expect(plainAsker(scripted).confirm(question)).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: "Cannot remove the variable without --force in non-interactive mode",
      });
    });
  });

  describe("a choice", () => {
    const framework = { name: "framework", message: "Which framework?", options };

    it("numbers the options under the question", async () => {
      const talk = typing("2");

      await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).select(framework);

      expect(talk.shown()).toContain("Which framework?\n  1)  A\n  2)  B\n");
    });

    it("gives back the value of the option that was named", async () => {
      const talk = typing("2");

      expect(
        await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).select(framework),
      ).toBe("b");
    });

    it("asks again when the answer names no option", async () => {
      const talk = typing("9", "1");

      expect(
        await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).select(framework),
      ).toBe("a");
      expect(talk.shown()).toContain("Please answer with a number between 1 and 2.");
    });

    it("takes an empty answer as the initial value", async () => {
      const talk = typing("");

      const answer = await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).select({
        ...framework,
        initialValue: "b",
      });

      expect(answer).toBe("b");
    });

    // A choice that exists but is not available yet is shown with its hint and
    // left unnumbered, so there is no number that chooses it.
    it("shows a disabled option without a number of its own", async () => {
      const talk = typing("1");

      const answer = await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).select({
        name: "server",
        message: "Which server?",
        options: [
          { value: "local", label: "Local", hint: "not running", disabled: true },
          { value: "cloud", label: "Cloud" },
        ],
      });

      expect(answer).toBe("cloud");
      expect(talk.shown()).toContain("  -)  Local — not running\n  1)  Cloud\n");
    });
  });

  describe("several choices", () => {
    const providers = { name: "providers", message: "Which providers?", options };

    it("takes them as numbers separated by commas", async () => {
      const talk = typing("1,2");

      expect(
        await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).multiselect(providers),
      ).toEqual(["a", "b"]);
    });

    it("asks again when one of them names no option", async () => {
      const talk = typing("1,9", "2");

      expect(
        await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).multiselect(providers),
      ).toEqual(["b"]);
    });

    it("asks again for an empty answer when one is required", async () => {
      const talk = typing("", "1");

      expect(
        await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).multiselect(providers),
      ).toEqual(["a"]);
      expect(talk.shown()).toContain("Please answer with at least one number.");
    });

    it("takes an empty answer as none when none is required", async () => {
      const talk = typing("");

      const answer = await plainAsker({
        ...ask,
        stdin: talk.stdin,
        stdout: talk.stdout,
      }).multiselect({
        ...providers,
        required: false,
      });

      expect(answer).toEqual([]);
    });
  });

  describe("a secret", () => {
    it("is asked on one line and answers with what was typed", async () => {
      const talk = typing("hunter2");

      const answer = await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).secret(
        typed("client secret"),
      );

      expect(answer).toBe("hunter2");
    });

    // Asserting the secret is absent from the output proves nothing: a line
    // editor fed programmatically echoes nothing either way. What masking
    // does show is that the question is written and the line is closed by
    // hand, so the whole output is the question and a newline.
    it("writes the question and nothing else", async () => {
      const talk = typing("hunter2");

      await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).secret(
        typed("client secret"),
      );

      expect(talk.shown()).toBe("Client ID \n");
    });

    it("says what is wrong and asks again, as the other questions do", async () => {
      const talk = typing("short", "longenough");

      const answer = await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).secret({
        ...typed("client secret"),
        parse: (value: string) =>
          value.length < 8
            ? ({ ok: false, problem: "A client secret is at least 8 characters" } as const)
            : ({ ok: true, value } as const),
      });

      expect(answer).toBe("longenough");
      expect(talk.shown()).toContain("A client secret is at least 8 characters");
    });
  });

  // The one part of a masked question that is its own behaviour rather than
  // the line editor's, and the only part a driven question cannot show.
  describe("the output a masked question is read through", () => {
    const captured = () => {
      const chunks: string[] = [];
      return {
        chunks,
        target: new Writable({
          write(chunk: unknown, _encoding: unknown, done: () => void) {
            chunks.push(String(chunk));
            done();
          },
        }),
      };
    };

    it("lets the question through once", () => {
      const { chunks, target } = captured();
      const out = new Swallowing(target, "Secret? ");

      out.write("Secret? ");
      out.write("Secret? ");

      expect(chunks).toEqual(["Secret? "]);
    });

    it("swallows everything the line editor would echo after it", () => {
      const { chunks, target } = captured();
      const out = new Swallowing(target, "Secret? ");

      out.write("Secret? ");
      out.write("h");
      out.write("u");

      expect(chunks.join("")).toBe("Secret? ");
    });
  });

  describe("walking away from a question", () => {
    it("is a cancellation, not an empty answer", async () => {
      const talk = typing();

      await expect(
        plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).text(typed()),
      ).rejects.toMatchObject({ code: "E_CANCELLED", exitCode: 130 });
    });

    // Clack's `└  Cancelled.` closes a chain and a normal command has none,
    // so nothing follows the question. Asserting clack's `cancel` was not
    // called would pass however this is drawn: the double never calls it.
    it("writes nothing after the question it was asked", async () => {
      const talk = typing();

      await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout })
        .text(typed())
        .catch(() => undefined);

      expect(talk.shown()).toBe("Client ID ");
    });
  });

  it("draws none of clack's prompts, whatever it is asked", async () => {
    const talk = typing("y");

    await plainAsker({ ...ask, stdin: talk.stdin, stdout: talk.stdout }).confirm({
      name: "x",
      message: "X?",
    });

    expect(confirm).not.toHaveBeenCalled();
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
  // five and takes the kind as an argument.
  it("names no question by a kind string outside the engine", async () => {
    const tagged: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const source = await readFile(file, "utf8");
      const path = relative(SRC, file).split(sep).join("/");
      if (path !== "lib/input.ts" && /kind: ["'](text|secret|confirm)["']/.test(source)) {
        tagged.push(path);
      }
    }

    expect(tagged).toEqual([]);
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
