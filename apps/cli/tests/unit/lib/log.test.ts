import { afterEach, describe, expect, it } from "vitest";

import { installLogSink, log } from "@/lib/log";

import { recordLog } from "../../helpers/log";

let stops: Array<() => void> = [];

afterEach(() => {
  for (const stop of stops.splice(0).reverse()) {
    stop();
  }
  stops = [];
});

describe("log", () => {
  it("says nothing when no command has installed a sink", () => {
    expect(() => {
      log.info("nobody is listening");
    }).not.toThrow();
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
});
