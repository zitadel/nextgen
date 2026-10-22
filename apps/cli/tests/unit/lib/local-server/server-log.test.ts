import { describe, expect, it } from "vitest";

import {
  LogLineReader,
  atLeast,
  lastLines,
  levelOf,
  logLines,
  logText,
  renderLogLine,
} from "../../../../src/lib/local-server/server-log";

/** A record as the server writes it by default, in slog's text format. */
function record(level: string, msg: string): string {
  return `time=2026-10-22T07:58:44.735-07:00 level=${level} source=github.com/zitadel/nextgen/internal/service/flow_sso_redirect_issuer.go:134 msg="${msg}" stream=service`;
}

const PANIC = [
  "panic: runtime error: invalid memory address or nil pointer dereference",
  "[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x10]",
  "",
  "goroutine 1 [running]:",
  "main.main()",
  "\t/src/main.go:10 +0x1c",
];

describe("levelOf", () => {
  it.each([
    ["DEBUG", "debug"],
    ["INFO", "info"],
    ["WARN", "warn"],
    ["ERROR", "error"],
  ])("reads a %s record in the text format", (name, level) => {
    expect(levelOf(record(name, "x"))).toBe(level);
  });

  it.each([
    ["INFO+2", "info"],
    ["WARN-2", "warn"],
    ["ERROR+4", "error"],
  ])("reads a level between two named ones, %s, as the lower name", (name, level) => {
    expect(levelOf(record(name, "x"))).toBe(level);
  });

  it("reads a record without a time", () => {
    expect(levelOf('level=WARN msg="request rejected"')).toBe("warn");
  });

  it("reads what the default logger writes before the server sets up its own", () => {
    expect(
      levelOf("2026/10/22 07:58:44 WARN created server master key file path=/tmp/key.pem"),
    ).toBe("warn");
  });

  it("reads the JSON format", () => {
    expect(levelOf('{"time":"2026-10-22T07:58:44Z","level":"ERROR","msg":"request failed"}')).toBe(
      "error",
    );
  });

  it("reads the GCP format's severity", () => {
    expect(levelOf('{"severity":"WARNING","message":"sso provider unavailable"}')).toBe("warn");
  });

  it.each([
    "panic: runtime error: index out of range [3] with length 3",
    "fatal error: concurrent map writes",
  ])("reads a crash as an error: %s", (line) => {
    expect(levelOf(line)).toBe("error");
  });

  it("is not fooled by a level inside the message", () => {
    expect(levelOf(record("INFO", "saw level=ERROR upstream"))).toBe("info");
  });

  it.each(["goroutine 1 [running]:", "{not json", '{"msg":"no level"}', ""])(
    "finds no level in %j",
    (line) => {
      expect(levelOf(line)).toBeUndefined();
    },
  );
});

describe("LogLineReader", () => {
  it("keeps a line that one part starts until the part that ends it", () => {
    const reader = new LogLineReader();
    const line = record("WARN", "sso provider unavailable");

    expect(reader.read(line.slice(0, 20))).toEqual([]);
    expect(reader.read(`${line.slice(20)}\n`)).toEqual([{ text: line, level: "warn" }]);
  });

  it("drops the carriage return of a CRLF line break", () => {
    expect(new LogLineReader().read("level=INFO msg=x\r\n")).toEqual([
      { text: "level=INFO msg=x", level: "info" },
    ]);
  });

  it("hands over the last line at the end of a log that does not end with a line break", () => {
    const reader = new LogLineReader();
    reader.read("level=ERROR msg=x");

    expect(reader.end()).toEqual([{ text: "level=ERROR msg=x", level: "error" }]);
    expect(reader.end()).toEqual([]);
  });

  it("gives a crash's stack trace the crash's level", () => {
    const lines = logLines([record("INFO", "handled request"), ...PANIC].join("\n"));

    expect(lines.map((line) => line.level)).toEqual(["info", ...PANIC.map(() => "error")]);
  });

  it("gives a line no record comes before no level", () => {
    expect(logLines("goroutine 7 [select]:\nlevel=INFO msg=x\n")).toEqual([
      { text: "goroutine 7 [select]:", level: undefined },
      { text: "level=INFO msg=x", level: "info" },
    ]);
  });
});

describe("picking lines", () => {
  const lines = logLines(
    [
      record("INFO", "one"),
      record("WARN", "two"),
      record("INFO", "three"),
      record("ERROR", "four"),
      record("DEBUG", "five"),
      "a line without a record above it",
    ].join("\n"),
  );

  it("keeps the lines at a level or above", () => {
    expect(atLeast(lines, "warn").map((line) => line.text)).toEqual([
      record("WARN", "two"),
      record("ERROR", "four"),
    ]);
  });

  it("keeps every line without a level", () => {
    expect(atLeast(lines, undefined)).toEqual(lines);
  });

  it("counts only the lines at the level towards the tail", () => {
    expect(lastLines(lines, 1, "warn").map((line) => line.text)).toEqual([record("ERROR", "four")]);
  });

  it("takes the last lines of all of them without a level", () => {
    expect(lastLines(lines, 2, undefined).map((line) => line.text)).toEqual([
      record("DEBUG", "five"),
      "a line without a record above it",
    ]);
  });

  it("puts the lines back together as the log has them", () => {
    expect(logText(logLines("level=INFO msg=a\nlevel=WARN msg=b"))).toBe(
      "level=INFO msg=a\nlevel=WARN msg=b\n",
    );
  });
});

describe("renderLogLine", () => {
  it("prints a line as it is without color", () => {
    expect(renderLogLine({ text: record("WARN", "x"), level: "warn" }, false)).toBe(
      record("WARN", "x"),
    );
  });

  it("prints a warning in yellow", () => {
    expect(renderLogLine({ text: "level=WARN msg=x", level: "warn" }, true)).toBe(
      "\u001b[33mlevel=WARN msg=x\u001b[39m",
    );
  });

  it("prints an error in red", () => {
    expect(renderLogLine({ text: "level=ERROR msg=x", level: "error" }, true)).toBe(
      "\u001b[31mlevel=ERROR msg=x\u001b[39m",
    );
  });

  it("dims a debug line", () => {
    expect(renderLogLine({ text: "level=DEBUG msg=x", level: "debug" }, true)).toBe(
      "\u001b[2mlevel=DEBUG msg=x\u001b[22m",
    );
  });

  it.each([
    ["an info line", "info"],
    ["a line without a level", undefined],
  ] as const)("leaves %s as it is", (_, level) => {
    expect(renderLogLine({ text: "msg=x", level }, true)).toBe("msg=x");
  });

  it("escapes what would drive the terminal", () => {
    const line = { text: "panic: \u001b]0;pwned\u0007", level: "error" } as const;

    expect(renderLogLine(line, false)).toBe("panic: \\x1b]0;pwned\\x07");
  });

  it("keeps the tab that indents a stack frame", () => {
    expect(renderLogLine({ text: "\t/src/main.go:10", level: "error" }, false)).toBe(
      "\t/src/main.go:10",
    );
  });
});
