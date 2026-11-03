import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@oclif/table", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oclif/table")>();
  return { ...actual, makeTable: vi.fn(actual.makeTable) };
});

import { makeTable } from "@oclif/table";

import { aTabulatingCommand } from "../../../helpers/tabulate";

const draw = (argv: string[] = []) => aTabulatingCommand(argv);

beforeEach(() => {
  vi.mocked(makeTable).mockClear();
});

const onATerminal = async <T>(run: () => Promise<T>): Promise<T> => {
  const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  try {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    return await run();
  } finally {
    if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
    else delete (process.stdout as unknown as Record<string, unknown>).isTTY;
  }
};

const piped = async <T>(run: () => Promise<T>): Promise<T> => {
  const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  try {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    return await run();
  } finally {
    if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
    else delete (process.stdout as unknown as Record<string, unknown>).isTTY;
  }
};

/** What a list prints for a person or a pipe, for the given flags and view. */
const printed = async (
  flags: { plain: boolean | undefined },
  view: Parameters<ReturnType<typeof draw>["drawList"]>[1],
  argv: string[] = [],
): Promise<string> => {
  const result = await draw(argv).drawList(flags, view);
  return result.status === "ok" ? (result.pretty ?? "") : "";
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

    const render = async (tty: boolean): Promise<string> => {
      const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
      const columns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
      Object.defineProperty(process.stdout, "isTTY", { value: tty, configurable: true });
      Object.defineProperty(process.stdout, "columns", { value: 30, configurable: true });
      try {
        return await draw().draw(["id", "url"], [{ id, url }]);
      } finally {
        for (const [key, saved] of [
          ["isTTY", isTTY],
          ["columns", columns],
        ] as const) {
          if (saved) Object.defineProperty(process.stdout, key, saved);
          else delete (process.stdout as unknown as Record<string, unknown>)[key];
        }
      }
    };

    it("keeps a long id and url whole on one row instead of breaking them across lines", async () => {
      const table = (await render(true)).split("\n");

      expect(table).toHaveLength(3);
      expect(table[2]).toContain(id);
      expect(table[2]).toContain(url);
    });

    it("prints the same table as a pipe does", async () => {
      expect(await render(true)).toBe(await render(false));
    });
  });
});

describe("a list for a person", () => {
  const view = { columns: ["id"], rows: [{ id: "a" }], singular: "thing", empty: "No things." };

  it("draws the table, a blank line, a count and the footer", async () => {
    const list = await onATerminal(() => printed({ plain: false }, { ...view, footer: ["More."] }));

    expect(list).toBe("  id\n ────\n  a\n\n1 thing\nMore.");
  });

  it("says so when the list is empty", async () => {
    expect(await onATerminal(() => printed({ plain: false }, { ...view, rows: [] }))).toBe(
      "No things.",
    );
  });

  it("pluralises the count, with the plural when one is given", async () => {
    const rows = [{ id: "a" }, { id: "b" }];

    expect(await onATerminal(() => printed({ plain: false }, { ...view, rows }))).toContain(
      "2 things",
    );
    expect(
      await onATerminal(() => printed({ plain: false }, { ...view, rows, plural: "people" })),
    ).toContain("2 people");
  });

  it("draws nothing under --json", async () => {
    const list = await onATerminal(() => printed({ plain: false }, view, ["--json"]));

    expect(list).toBe("");
    expect(makeTable).not.toHaveBeenCalled();
  });
});

describe("a list for a script", () => {
  const view = { columns: ["id"], rows: [{ id: "a" }], singular: "thing", empty: "No things." };

  it("is plain for the --plain flag, and when there is no terminal", async () => {
    expect(await onATerminal(() => printed({ plain: true }, view))).toBe("a");
    expect(await piped(() => printed({ plain: false }, view))).toBe("a");
    expect(await piped(() => printed({ plain: undefined }, view))).toBe("a");
  });

  it("is a table for a terminal that did not ask for plain", async () => {
    expect(await onATerminal(() => printed({ plain: undefined }, view))).toContain("──");
  });

  it("prints nothing for an empty list", async () => {
    expect(await printed({ plain: true }, { ...view, rows: [] })).toBe("");
  });

  it("emits one tab-separated record per line, with no header", async () => {
    const rows = await printed(
      { plain: true },
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
      { plain: true },
      { ...view, columns: ["id", "gone", "n"], rows: [{ id: "a", n: 3 }] },
    );

    expect(rows).toBe("a\t\t3");
  });

  it("escapes tabs and newlines inside a value", async () => {
    const rows = await printed(
      { plain: true },
      { ...view, columns: ["note"], rows: [{ note: "a\tb\nc" }] },
    );

    expect(rows).toBe("a\\tb\\nc");
  });

  it("escapes control characters so a value cannot drive the terminal", async () => {
    const rows = await printed(
      { plain: true },
      { ...view, columns: ["id"], rows: [{ id: "a\u001b[2Jb" }] },
    );

    expect(rows).not.toContain("\u001b");
    expect(rows).toBe("a\\x1b[2Jb");
  });
});

describe("emitList", () => {
  const view = { columns: ["id"], rows: [{ id: "a" }], singular: "thing", empty: "No things." };

  it("builds the canonical list data from the rows", async () => {
    const result = await draw().drawList({ plain: true }, view);

    expect(result).toMatchObject({
      data: { items: [{ id: "a" }], count: 1, next_page_token: null },
    });
  });

  it("carries other items in the data when the drawn rows are a view of them", async () => {
    const result = await draw().drawList(
      { plain: true },
      { ...view, items: [{ id: "a", more: 1 }] },
    );

    expect(result).toMatchObject({ data: { items: [{ id: "a", more: 1 }] } });
  });

  it("adds extra fields beside items, count and next_page_token", async () => {
    const result = await draw().drawList({ plain: true }, { ...view, extra: { resolved: "x" } });

    expect(result).toMatchObject({ data: { count: 1, resolved: "x" } });
  });

  it("lets a list with a fixed shape supply its own data", async () => {
    const result = await draw().drawList({ plain: true }, { ...view, data: { operations: [] } });

    expect(result).toMatchObject({ data: { operations: [] } });
  });

  it("gives a pipe tab-separated rows, and sends the next steps beside them", async () => {
    const result = await draw().drawList({ plain: true }, view);

    expect(result).toMatchObject({ pretty: "a", machineReadable: true });
  });

  it("keeps the next steps with the table for a person", async () => {
    const result = await onATerminal(() => draw().drawList({ plain: false }, view));

    expect(result).toMatchObject({ machineReadable: false });
  });

  it("reports the next page's cursor, its command and a footer that names it", async () => {
    const result = await draw().drawList(
      { plain: false },
      { ...view, page: { token: "p2", command: "thing list", flags: ["--limit 1"] } },
    );

    expect(result).toMatchObject({
      data: { next_page_token: "p2" },
      next: { commands: [expect.stringContaining("thing list --limit 1 --page-token p2 --json")] },
    });
  });

  it("names the next page in the footer of a person's list", async () => {
    const result = await onATerminal(() =>
      draw().drawList({ plain: false }, { ...view, page: { token: "p2", command: "thing list" } }),
    );

    expect(result).toMatchObject({
      pretty: expect.stringContaining("More available: --page-token p2 (or --all)"),
    });
  });

  it("joins a cursor that starts with a dash to its option, so it stays one option", async () => {
    const result = await onATerminal(() =>
      draw().drawList({ plain: false }, { ...view, page: { token: "-p2", command: "thing list" } }),
    );

    expect(result).toMatchObject({ pretty: expect.stringContaining("--page-token=-p2") });
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
      if (!file.endsWith(".ts") || file === join("lib", "oclif", "tabulatable.ts")) continue;
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
      if (!file.endsWith(".ts") || file === join("lib", "oclif", "tabulatable.ts")) continue;
      if (/["']@oclif\/table["']/.test(await readFile(join(root, file), "utf8"))) {
        importing.push(file);
      }
    }

    expect(importing).toEqual([]);
  });
});
