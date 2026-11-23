import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, vi } from "vitest";

vi.mock("@oclif/table", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oclif/table")>();
  return { ...actual, makeTable: vi.fn(actual.makeTable) };
});

import { makeTable } from "@oclif/table";

import ApiLs from "@/cli/commands/api/ls";
import DeploymentGet from "@/cli/commands/deployment/get";
import DeploymentList from "@/cli/commands/deployment/list";
import EnvList from "@/cli/commands/env/list";
import InvitationGet from "@/cli/commands/invitation/get";
import InvitationList from "@/cli/commands/invitation/list";
import OriginList from "@/cli/commands/origin/list";
import PreviewList from "@/cli/commands/preview/list";
import VariableGet from "@/cli/commands/variable/get";
import VariableList from "@/cli/commands/variable/list";
import VariableResolve from "@/cli/commands/variable/resolve";
import { it } from "@tests/fixtures";
import { parseFlag } from "@tests/helpers/inputs";
import { asTerminal, offTerminal, type TerminalFixture } from "@tests/fixtures/terminal";
import { aTableDrawnByARun, aTabulatingCommand } from "@tests/helpers/tabulate";
import type { ListFlags } from "@/lib/oclif/tabulatable";

const draw = (argv: string[] = []) => aTabulatingCommand(argv);

beforeEach(() => {
  vi.mocked(makeTable).mockClear();
});

/** What a list prints for a person or a pipe, for the given flags and view. */
const printed = async (
  flags: ListFlags,
  view: Parameters<ReturnType<typeof draw>["drawList"]>[1],
  argv: string[] = [],
): Promise<string> => {
  const result = await draw(argv).drawList(flags, view);
  if (result.status !== "ok") {
    throw new Error(`expected an ok result, got ${result.status}`);
  }
  // A list arrives spelled out: its table is painted, its plain records are
  // what a pipe reads, and either way nothing escapes it again on the way out.
  return result.pretty?.text ?? "";
};

/**
 * What a list is drawn from for a person at a terminal: its summary, whose
 * headline is the count, whose lines are the table and whose extras sit beside
 * the count.
 */
const summarised = async (
  flags: ListFlags,
  view: Parameters<ReturnType<typeof draw>["drawList"]>[1],
  argv: string[] = [],
) => {
  const result = await draw(argv).drawList(flags, view);
  if (result.status !== "ok") {
    throw new Error(`expected an ok result, got ${result.status}`);
  }
  return result.summary;
};

describe("tabulate", () => {
  it("aligns columns, heads them by the path's last segment, and resolves nested paths", async () => {
    const table = await draw().draw(
      ["id", "metadata.status", "created_at"],
      [
        { id: "user_1", metadata: { status: "active" }, created_at: "2026-01-01T00:00:00Z" },
        { id: "user_22", metadata: { status: "suspended" } },
      ],
    );
    expect(table.split("\n")).toEqual([
      "  id        status      created_at",
      " ────────────────────────────────────────────",
      "  user_1    active      2026-01-01T00:00:00Z",
      "  user_22   suspended",
    ]);
  });

  /**
   * The style the table was asked for, rather than the bytes it came back
   * with: the library emits an escape sequence only where its own colour
   * support agrees, and that is settled when it loads, from the real process
   * streams. What the run decided is the thing worth pinning.
   */
  const headerStyle = async (argv: string[]): Promise<unknown> => {
    // Every variable the run reads to decide colour, so the answer is the
    // argv's and not the runner's: CI sets `NO_COLOR`, and a terminal sets
    // `TERM`, each of which would otherwise decide this on its own.
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("TERM", "xterm");
    vi.stubEnv("FORCE_COLOR", "1");
    await aTableDrawnByARun(argv);
    return vi.mocked(makeTable).mock.calls.at(-1)?.[0]?.headerOptions;
  };

  it("asks for an unstyled header where the run's output is not coloured", async () => {
    expect(await headerStyle(["--no-color"])).toEqual({ bold: false, color: undefined });
  });

  it("asks for a coloured header where the run's output is coloured", async () => {
    expect(await headerStyle(["--color"])).toEqual({ bold: true, color: "blue" });
  });

  it("renders missing values empty and non-strings as JSON", async () => {
    const table = await draw().draw(["n", "flag", "gone"], [{ n: 3, flag: true, gone: null }]);
    expect(table.split("\n")[2]).toBe("  3   true");
  });

  it("renders the header and its rule for an empty list", async () => {
    expect((await draw().draw(["id"], [])).split("\n")).toEqual(["  id", " ────"]);
  });

  it("measures wide characters by how they are drawn, so the column after them lines up", async () => {
    const table = await draw().draw(
      ["name", "id"],
      [
        { name: "你好世界", id: "x" },
        { name: "ab", id: "yy" },
      ],
    );
    expect(table.split("\n")).toEqual([
      "  name       id",
      " ───────────────",
      "  你好世界   x",
      "  ab         yy",
    ]);
  });

  it("escapes control characters so a value cannot drive the terminal or split its row", async () => {
    const table = await draw().draw(["id", "name"], [{ id: "a\u001b[2Jb", name: "x\ty\nz" }]);

    expect(table).not.toContain("\u001b");
    expect(table).not.toContain("\t");
    expect(table.split("\n")[2]).toBe("  a\\x1b[2Jb   x\\x09y\\x0az");
  });

  it("draws nothing under --json, so a machine does not pay for a table it throws away", async () => {
    expect(await draw(["--json"]).draw(["id"], [{ id: "a" }])).toBe("");
    expect(makeTable).not.toHaveBeenCalled();
  });

  describe("on a narrow terminal", () => {
    const id = `usr_${"a".repeat(40)}`;
    const url = `https://example.com/${"b".repeat(60)}`;

    /**
     * Draws the table for a stdout of the given kind, thirty columns wide.
     *
     * @param terminal - The terminal fixture whose stdout is set.
     * @param tty - Whether stdout reports being a terminal.
     * @returns The drawn table.
     */
    const render = async (terminal: TerminalFixture, tty: boolean): Promise<string> => {
      terminal.tty(tty);
      terminal.columns(30);
      return draw().draw(["id", "url"], [{ id, url }]);
    };

    it("keeps a long id and url whole on one row instead of breaking them across lines", async ({
      terminal,
    }) => {
      const table = (await render(terminal, true)).split("\n");

      expect(table).toHaveLength(3);
      expect(table[2]).toContain(id);
      expect(table[2]).toContain(url);
    });

    it("prints the same table as a pipe does", async ({ terminal }) => {
      expect(await render(terminal, true)).toBe(await render(terminal, false));
    });
  });
});

describe("a list for a person", () => {
  const rows = [{ id: "a" }];
  const view = {
    columns: ["id"],
    rows,
    items: rows,
    singular: "thing",
    empty: "No things",
    footer: [],
    page: null,
    extra: {},
  };

  it("states the count as its headline, the table under it and the footer beside it", async () => {
    const summary = await asTerminal(() =>
      summarised({ plain: false, fields: undefined }, { ...view, footer: ["More."] }),
    );

    expect(summary).toEqual({
      title: "Found 1 thing",
      sections: [],
      lines: ["  id", " ────", "  a"],
      extras: ["More."],
    });
  });

  it("refuses --fields for a list that carries no records to choose from", async () => {
    await expect(
      draw().drawList(
        {
          plain: false,
          fields: ["id"],
        },
        {
          ...view,
          items: undefined,
          data: {},
        },
      ),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "This list has no fields to choose from",
    });
  });

  it("builds the table once, and prints no second rendering of it", async () => {
    const result = await asTerminal(() =>
      draw().drawList({ plain: false, fields: undefined }, view),
    );

    expect(makeTable).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("pretty");
  });

  it("says so when the list is empty", async () => {
    expect(
      await asTerminal(() =>
        summarised({ plain: false, fields: undefined }, { ...view, rows: [] }),
      ),
    ).toEqual({
      title: "No things",
      sections: [],
    });
  });

  it("escapes a footer line, which names what the server answered", async () => {
    const footer = ["Frozen by dep_1\u001b[2J for https://a.example"];

    const summary = await asTerminal(() =>
      summarised({ plain: false, fields: undefined }, { ...view, footer }),
    );

    expect(JSON.stringify(summary)).not.toContain("\\u001b");
    expect(summary?.extras).toEqual(["Frozen by dep_1\\x1b[2J for https://a.example"]);
  });

  it("escapes the empty line, which names what the server answered", async () => {
    const empty = "dep_1\u001b[2J froze no variables";

    const summary = await asTerminal(() =>
      summarised({ plain: false, fields: undefined }, { ...view, rows: [], empty }),
    );

    expect(summary?.title).toBe("dep_1\\x1b[2J froze no variables");
  });

  it("pluralises the count, with the plural when one is given", async () => {
    const rows = [{ id: "a" }, { id: "b" }];

    expect(
      (await asTerminal(() => summarised({ plain: false, fields: undefined }, { ...view, rows })))
        ?.title,
    ).toBe("Found 2 things");
    expect(
      (
        await asTerminal(() =>
          summarised({ plain: false, fields: undefined }, { ...view, rows, plural: "people" }),
        )
      )?.title,
    ).toBe("Found 2 people");
  });

  it("draws nothing under --json", async () => {
    const list = await asTerminal(() =>
      printed({ plain: false, fields: undefined }, view, ["--json"]),
    );

    expect(list).toBe("");
    expect(makeTable).not.toHaveBeenCalled();
  });
});

describe("a list for a script", () => {
  const rows = [{ id: "a" }];
  const view = {
    columns: ["id"],
    rows,
    items: rows,
    singular: "thing",
    empty: "No things",
    footer: [],
    page: null,
    extra: {},
  };

  it("is plain for the --plain flag, and when there is no terminal", async () => {
    expect(await asTerminal(() => printed({ plain: true, fields: undefined }, view))).toBe("a");
    expect(await offTerminal(() => printed({ plain: false, fields: undefined }, view))).toBe("a");
    expect(await offTerminal(() => printed({ plain: undefined, fields: undefined }, view))).toBe(
      "a",
    );
  });

  it("builds no table for a plain run, which draws none", async () => {
    await asTerminal(() => draw().drawList({ plain: true, fields: undefined }, view));
    await offTerminal(() => draw().drawList({ plain: false, fields: undefined }, view));

    expect(makeTable).not.toHaveBeenCalled();
  });

  it("is a table for a terminal that did not ask for plain", async () => {
    const summary = await asTerminal(() =>
      summarised({ plain: undefined, fields: undefined }, view),
    );

    expect(summary?.lines?.join("\n")).toContain("──");
  });

  it("prints nothing for an empty list", async () => {
    expect(await printed({ plain: true, fields: undefined }, { ...view, rows: [] })).toBe("");
  });

  it("says what the footer says beside the rows, not in them", async () => {
    const result = await draw().drawList(
      { plain: true, fields: undefined },
      { ...view, footer: ["Deployment dep_1", "Origins: https://a.example"] },
    );

    expect(result).toMatchObject({
      pretty: { kind: "piped", text: "a" },
      footer: "Deployment dep_1\nOrigins: https://a.example",
    });
  });

  it("says the list is empty beside the rows, so a pipe still hears it", async () => {
    const result = await draw().drawList(
      { plain: true, fields: undefined },
      { ...view, rows: [], items: [], empty: "No things" },
    );

    expect(result).toMatchObject({ pretty: { kind: "piped", text: "" }, footer: "No things" });
  });

  it("names the next page beside the rows", async () => {
    const result = await draw().drawList(
      { plain: true, fields: undefined },
      { ...view, page: { token: "p2" } },
    );

    expect(result).toMatchObject({ footer: "More available: --page-token p2 (or --all)" });
  });

  it("says nothing beside the rows when there is nothing to add", async () => {
    const result = await draw().drawList({ plain: true, fields: undefined }, view);

    expect(result).not.toHaveProperty("footer");
  });

  it("adds no footer under --json, which has an envelope for it", async () => {
    const result = await draw(["--json"]).drawList(
      { plain: true, fields: undefined },
      { ...view, footer: ["Deployment dep_1"] },
    );

    expect(result).not.toHaveProperty("footer");
  });

  it("emits one tab-separated record per line, with no header", async () => {
    const rows = await printed(
      { plain: true, fields: undefined },
      {
        ...view,
        columns: ["id", "metadata.status"],
        rows: [
          { id: "user_1", metadata: { status: "active" } },
          { id: "user_22", metadata: { status: "suspended" } },
        ],
      },
    );

    expect(rows).toBe("user_1\tactive\nuser_22\tsuspended");
  });

  it("keeps empty cells as empty fields so column positions hold", async () => {
    const rows = await printed(
      { plain: true, fields: undefined },
      { ...view, columns: ["id", "gone", "n"], rows: [{ id: "a", n: 3 }] },
    );

    expect(rows).toBe("a\t\t3");
  });

  it("escapes tabs and newlines inside a value", async () => {
    const rows = await printed(
      { plain: true, fields: undefined },
      { ...view, columns: ["note"], rows: [{ note: "a\tb\nc" }] },
    );

    expect(rows).toBe("a\\tb\\nc");
  });

  it("escapes control characters so a value cannot drive the terminal", async () => {
    const rows = await printed(
      { plain: true, fields: undefined },
      { ...view, columns: ["id"], rows: [{ id: "a\u001b[2Jb" }] },
    );

    expect(rows).not.toContain("\u001b");
    expect(rows).toBe("a\\x1b[2Jb");
  });
});

describe("emitList", () => {
  const rows = [{ id: "a" }];
  const view = {
    columns: ["id"],
    rows,
    items: rows,
    singular: "thing",
    empty: "No things",
    footer: [],
    page: null,
    extra: {},
  };

  it("builds the canonical list data from the rows", async () => {
    const result = await draw().drawList({ plain: true, fields: undefined }, view);

    expect(result).toMatchObject({
      data: { items: [{ id: "a" }], count: 1, next_page_token: null },
    });
  });

  it("carries other items in the data when the drawn rows are a view of them", async () => {
    const result = await draw().drawList(
      { plain: true, fields: undefined },
      { ...view, items: [{ id: "a", more: 1 }] },
    );

    expect(result).toMatchObject({ data: { items: [{ id: "a", more: 1 }] } });
  });

  it("adds extra fields beside items, count and next_page_token", async () => {
    const result = await draw().drawList(
      { plain: true, fields: undefined },
      { ...view, extra: { resolved: "x" } },
    );

    expect(result).toMatchObject({ data: { count: 1, resolved: "x" } });
  });

  it("lets a list with a fixed shape supply its own data", async () => {
    const result = await draw().drawList(
      { plain: true, fields: undefined },
      {
        columns: view.columns,
        rows: view.rows,
        singular: view.singular,
        empty: view.empty,
        footer: [],
        page: null,
        extra: {},
        data: { operations: [] },
      },
    );

    expect(result).toMatchObject({ data: { operations: [] } });
  });

  it("reports the cursor under the property the platform spells it as", async () => {
    const result = await draw().drawList(
      { plain: true, fields: undefined },
      { ...view, page: { token: "p2", cursorKey: "nextCursor" } },
    );

    expect(result).toMatchObject({ data: { items: [{ id: "a" }], count: 1, nextCursor: "p2" } });
    expect(result).not.toMatchObject({ data: { next_page_token: expect.anything() } });
  });

  it("does not let an extra field replace a canonical one", async () => {
    const replacing = draw().drawList(
      { plain: true, fields: undefined },
      // @ts-expect-error `count` belongs to the list itself
      { ...view, extra: { count: 99 } },
    );

    await expect(replacing).rejects.toThrow("may not replace count");
  });

  it("gives a pipe tab-separated rows, and sends the next steps beside them", async () => {
    const result = await draw().drawList({ plain: true, fields: undefined }, view);

    expect(result).toMatchObject({ pretty: { kind: "piped", text: "a" } });
  });

  it("keeps the next steps with the table for a person", async () => {
    const result = await asTerminal(() =>
      draw().drawList({ plain: false, fields: undefined }, view),
    );

    expect(result).toMatchObject({ summary: { title: "Found 1 thing" } });
  });

  it("reports the next page's cursor, its command and a footer that names it", async () => {
    const result = await draw(["--limit", "1"]).drawList(
      { plain: false, fields: undefined },
      { ...view, page: { token: "p2" } },
    );

    expect(result).toMatchObject({
      data: { next_page_token: "p2" },
      next: { commands: [expect.stringMatching(/thing list --limit 1 --page-token p2$/)] },
    });
  });

  it("asks for the next page with its token in place of the one the run was given", async () => {
    const result = await draw(["--page-token", "p1", "--all"]).drawList(
      { plain: false, fields: undefined },
      { ...view, page: { token: "p2" } },
    );

    expect(result).toMatchObject({
      next: { commands: [expect.stringMatching(/thing list --page-token p2$/)] },
    });
  });

  it("asks for the next page as JSON when the run was JSON", async () => {
    const result = await draw(["--json"]).drawList(
      { plain: false, fields: undefined },
      { ...view, page: { token: "p2" } },
    );

    expect(result).toMatchObject({
      next: { commands: [expect.stringMatching(/thing list --page-token p2 --json$/)] },
    });
  });

  it("names the next page in the footer of a person's list", async () => {
    const result = await asTerminal(() =>
      draw().drawList({ plain: false, fields: undefined }, { ...view, page: { token: "p2" } }),
    );

    expect(result).toMatchObject({
      summary: { extras: ["More available: --page-token p2 (or --all)"] },
    });
  });

  it("names the next page under an empty page too, since more may follow it", async () => {
    const result = await asTerminal(() =>
      draw().drawList(
        { plain: false, fields: undefined },
        {
          ...view,
          rows: [],
          items: [],
          empty: "No things on this page",
          page: { token: "p2" },
        },
      ),
    );

    expect(result).toMatchObject({
      data: { items: [], next_page_token: "p2" },
      summary: {
        title: "No things on this page",
        extras: ["More available: --page-token p2 (or --all)"],
      },
    });
  });

  it("quotes a cursor holding a control character so a shell reads it back as it is", async () => {
    const result = await asTerminal(() =>
      draw().drawList(
        { plain: false, fields: undefined },
        { ...view, page: { token: "a\u001bb" } },
      ),
    );

    expect(result).toMatchObject({
      summary: { extras: ["More available: --page-token $'a\\x1bb' (or --all)"] },
    });
  });

  it("joins a cursor that starts with a dash to its option, so it stays one option", async () => {
    const result = await asTerminal(() =>
      draw().drawList({ plain: false, fields: undefined }, { ...view, page: { token: "-p2" } }),
    );

    expect(result).toMatchObject({
      summary: { extras: [expect.stringContaining("--page-token=-p2")] },
    });
  });
});

describe("tabulateDetail", () => {
  const user = {
    id: "user_1",
    identifier: "ada@example.com",
    metadata: { status: "active", created_at: "2026-01-01T00:00:00Z", owner: null },
  };

  it("heads the record and labels each field by its last path segment", () => {
    expect(
      draw().drawDetail("ada@example.com", ["id", "metadata.status", "metadata.created_at"], user),
    ).toBe(
      [
        "ada@example.com",
        "",
        "id          user_1",
        "status      active",
        "created_at  2026-01-01T00:00:00Z",
      ].join("\n"),
    );
  });

  it("spells out what the server wrote into the field it is headed by", () => {
    expect(draw().drawDetail("ada\u001b]0;pwned\u0007@example.com", ["id"], user)).toBe(
      ["ada\\x1b]0;pwned\\x07@example.com", "", "id  user_1"].join("\n"),
    );
  });

  it("omits fields the record does not carry, rather than printing blanks", () => {
    expect(draw().drawDetail(undefined, ["id", "metadata.owner", "nope"], user)).toBe("id  user_1");
  });

  it("renders without a heading when the record has none", () => {
    expect(draw().drawDetail(undefined, ["id"], user)).toBe("id  user_1");
  });

  it("escapes control characters but keeps a value's own line breaks", () => {
    const out = draw().drawDetail(undefined, ["note"], { note: "a\u001b[2Jb\nc" });

    expect(out).not.toContain("\u001b");
    expect(out).toBe("note  a\\x1b[2Jb\nc");
  });
});

describe("Tabulatable", () => {
  it("is the only definition of --plain, so every list's help reads the same", async () => {
    const root = fileURLToPath(new URL("../../../../src", import.meta.url));
    const defining: string[] = [];

    for (const file of await readdir(root, { recursive: true })) {
      if (!file.endsWith(".ts") || file === join("lib", "oclif", "tabulatable.ts")) {
        continue;
      }
      if (/\bplain: Flags\./.test(await readFile(join(root, file), "utf8"))) {
        defining.push(file);
      }
    }

    expect(defining).toEqual([]);
  });

  it("is the only code that imports the table library, so no command can bypass the --json skip", async () => {
    const root = fileURLToPath(new URL("../../../../src", import.meta.url));
    const importing: string[] = [];

    for (const file of await readdir(root, { recursive: true })) {
      if (!file.endsWith(".ts") || file === join("lib", "oclif", "tabulatable.ts")) {
        continue;
      }
      if (/["']@oclif\/table["']/.test(await readFile(join(root, file), "utf8"))) {
        importing.push(file);
      }
    }

    expect(importing).toEqual([]);
  });

  it("is given its columns by a COLUMNS constant in every list command", async () => {
    const root = fileURLToPath(new URL("../../../../src/cli/commands", import.meta.url));
    const without: string[] = [];

    for (const file of await readdir(root, { recursive: true })) {
      if (!file.endsWith(".ts")) {
        continue;
      }
      const source = await readFile(join(root, file), "utf8");
      if (source.includes("emitList(") && !source.includes("const COLUMNS")) {
        without.push(file);
      }
    }

    expect(without).toEqual([]);
  });
});

describe("--fields", () => {
  const items = [
    {
      id: "a",
      name: "Ann",
      attributes: {
        email: "ann@example.com",
        age: 3,
      },
    },
    {
      id: "b",
      name: "Bob",
      attributes: {
        email: "bob@example.com",
        age: 4,
      },
    },
  ];
  const view = {
    columns: ["id", "name"],
    rows: items.map(({ id, name }) => ({ id, name })),
    items,
    singular: "user",
    empty: "No users found",
    footer: [],
    page: null,
    extra: {},
  };

  const dataOf = async (fields: readonly string[] | undefined) => {
    const result = await draw(["--json"]).drawList(
      {
        plain: false,
        fields,
      },
      view,
    );
    return result.status === "ok" ? result.data : undefined;
  };

  it("cuts each record under --json to the paths named, nested as they were", async () => {
    expect(await dataOf(["id", "attributes.email"])).toMatchObject({
      items: [
        {
          id: "a",
          attributes: { email: "ann@example.com" },
        },
        {
          id: "b",
          attributes: { email: "bob@example.com" },
        },
      ],
      count: 2,
    });
  });

  it("returns the whole record under --json without it", async () => {
    expect(await dataOf(undefined)).toMatchObject({ items });
  });

  it("draws the rows of a script from the paths named, read from the records", async () => {
    const result = await offTerminal(() => {
      return draw().drawList(
        {
          plain: true,
          fields: ["name", "attributes.age"],
        },
        view,
      );
    });

    expect(result.status === "ok" ? result.pretty?.text : undefined).toBe("Ann\t3\nBob\t4");
  });

  it("refuses a path the records do not carry, and names the ones they do", async () => {
    await expect(dataOf(["nope"])).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("refuses a list whose whole data is fixed, which has no records to cut", async () => {
    await expect(
      draw(["--json"]).drawList(
        {
          plain: false,
          fields: ["id"],
        },
        {
          ...view,
          items: undefined,
          data: { operations: [] },
          page: null,
          extra: {},
        },
      ),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
  });
});

describe("--fields cutting a record", () => {
  it("keeps the paths named, nested, and leaves out what the record lacks", async () => {
    expect(
      draw().cut(
        {
          a: 1,
          b: {
            c: 2,
            d: 3,
          },
        },
        ["a", "b.c", "x.y"],
      ),
    ).toEqual({
      a: 1,
      b: { c: 2 },
    });
  });

  it("reads a record as --json prints it, through its toJSON", async () => {
    class Held {
      readonly id = "dep_1";
      private readonly record = {
        project_id: "proj_1",
        status: "live",
      };

      toJSON(): Record<string, unknown> {
        return {
          id: this.id,
          ...this.record,
        };
      }
    }

    expect(draw().cut(new Held(), ["id", "project_id", "status"])).toEqual({
      id: "dep_1",
      project_id: "proj_1",
      status: "live",
    });
  });

  it("leaves out what a record only inherits", async () => {
    expect(
      draw().cut(
        {
          id: "a",
          attributes: { x: 1 },
        },
        ["attributes.constructor", "id"],
      ),
    ).toEqual({
      id: "a",
    });
  });

  it("ignores a path that names a prototype", async () => {
    expect(Object.keys(draw().cut({ a: 1 }, ["__proto__.polluted", "a"]) as object)).toEqual(["a"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("--fields on one record", () => {
  const record = {
    id: "a",
    name: "Ann",
    attributes: {
      email: "ann@example.com",
      age: 3,
    },
  };

  it("carries the whole record and the default columns when no field was chosen", async () => {
    const view = draw().view(record, undefined, ["id", "name"]);

    expect(view.data).toBe(record);
    expect(view.columns).toEqual(["id", "name"]);
  });

  it("cuts the data to the fields chosen and shows them as the columns", async () => {
    const view = draw().view(record, ["id", "attributes.email"], ["name"]);

    expect(view.data).toEqual({
      id: "a",
      attributes: { email: "ann@example.com" },
    });
    expect(view.columns).toEqual(["id", "attributes.email"]);
  });

  it("leaves a field the record lacks out of the data and does not refuse it", async () => {
    const view = draw().view(record, ["id", "responded_by"], ["name"]);

    expect(view.data).toEqual({ id: "a" });
    expect(view.columns).toEqual(["id", "responded_by"]);
  });
});

describe("every command taking --fields", () => {
  it.each([
    ["variable list", VariableList.flags.fields],
    ["variable resolve", VariableResolve.flags.fields],
    ["variable get", VariableGet.flags.fields],
    ["deployment list", DeploymentList.flags.fields],
    ["deployment get", DeploymentGet.flags.fields],
    ["invitation list", InvitationList.flags.fields],
    ["invitation get", InvitationGet.flags.fields],
    ["preview list", PreviewList.flags.fields],
    ["origin list", OriginList.flags.fields],
    ["env list", EnvList.flags.fields],
    ["api ls", ApiLs.flags.fields],
  ])("judges a field by its shape before any request, in %s", async (_name, flag) => {
    await expect(parseFlag(flag, "no_such_field", "fields")).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });
});
