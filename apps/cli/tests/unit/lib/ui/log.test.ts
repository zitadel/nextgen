import { describe, expect, onTestFinished } from "vitest";

import { log } from "@/lib/ui/log";
import { it } from "@tests/fixtures";
import { recordLog } from "@tests/fixtures/log";

describe("log", () => {
  it("writes a line plainly when no command has installed a sink, so code outside a command is heard", ({
    terminal,
  }) => {
    log.info("the skills offer");
    log.info("a statement");
    log.warn("a warning");
    log.debug("a detail nobody asked for");

    expect(terminal.shown()).toBe("the skills offer\na statement\n");
    expect(terminal.errors()).toBe("Warning: a warning\n");
  });

  it.each([
    ["info", () => log.info("a")],
    ["warn", () => log.warn("a")],
    ["fail", () => log.fail("a")],
    ["debug", () => log.debug("a")],
  ])("hands a %s line to the sink with its level", (level, say) => {
    const recorded = recordLog();
    onTestFinished(recorded.stop);

    say();

    expect(recorded.said).toEqual([{ level, text: "a" }]);
  });

  it("formats the arguments the way console does", () => {
    const recorded = recordLog();
    onTestFinished(recorded.stop);

    log.debug("asset probe failed:", new Error("boom").message, 3);

    expect(recorded.said).toEqual([{ level: "debug", text: "asset probe failed: boom 3" }]);
  });

  it("puts back the sink that was installed before, when one is removed", () => {
    const outer = recordLog();
    const stopInner = log.install(() => undefined);

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
