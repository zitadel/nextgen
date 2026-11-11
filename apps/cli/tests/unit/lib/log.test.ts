import { afterEach, describe, expect, it } from "vitest";

import { installLogSink, log } from "@/lib/log";

import { recordLog } from "@tests/helpers/log";

let stops: Array<() => void> = [];

afterEach(() => {
  for (const stop of stops.splice(0).reverse()) {
    stop();
  }
  stops = [];
});

describe("log", () => {
  it("writes a line plainly when no command has installed a sink, so code outside a command is heard", () => {
    const written: string[] = [];
    const out = process.stdout.write;
    const err = process.stderr.write;
    process.stdout.write = ((chunk: string) => {
      written.push(`out:${chunk}`);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => {
      written.push(`err:${chunk}`);
      return true;
    }) as typeof process.stderr.write;
    try {
      log.plain("the skills offer");
      log.info("a statement");
      log.warn("a warning");
      log.debug("a detail nobody asked for");
    } finally {
      process.stdout.write = out;
      process.stderr.write = err;
    }

    expect(written).toEqual([
      "out:the skills offer\n",
      "out:a statement\n",
      "err:Warning: a warning\n",
    ]);
  });

  it.each([
    ["info", () => log.info("a")],
    ["done", () => log.done("a")],
    ["start", () => log.start("a")],
    ["warn", () => log.warn("a")],
    ["fail", () => log.fail("a")],
    ["plain", () => log.plain("a")],
    ["debug", () => log.debug("a")],
  ])("hands a %s line to the sink with its level", (level, say) => {
    const recorded = recordLog();
    stops.push(recorded.stop);

    say();

    expect(recorded.said).toEqual([{ level, text: "a" }]);
  });

  it("formats the arguments the way console does", () => {
    const recorded = recordLog();
    stops.push(recorded.stop);

    log.debug("asset probe failed:", new Error("boom").message, 3);

    expect(recorded.said).toEqual([{ level: "debug", text: "asset probe failed: boom 3" }]);
  });

  it("puts back the sink that was installed before, when one is removed", () => {
    const outer = recordLog();
    const stopInner = installLogSink(() => undefined);

    stopInner();
    log.info("back to the outer");
    outer.stop();

    expect(outer.said).toEqual([{ level: "info", text: "back to the outer" }]);
  });

  it("does not draw into a sink that was removed out of order", () => {
    const first = recordLog();
    const second = recordLog();

    first.stop();
    second.stop();
    log.debug("after both ended");

    expect(first.said).toEqual([]);
  });

  it("keeps drawing into the newest sink when an older one is removed", () => {
    const first = recordLog();
    const second = recordLog();

    first.stop();
    log.info("still running");
    second.stop();

    expect(second.said).toEqual([{ level: "info", text: "still running" }]);
  });
});
