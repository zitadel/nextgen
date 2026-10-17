import { describe, expect, it, vi } from "vitest";

import { CONFIG_CHANGE_EVENT, onConfigChange } from "./config-change.js";

describe("onConfigChange", () => {
  it("calls the listener when the config-change event fires on globalThis", () => {
    const listener = vi.fn();
    const unsubscribe = onConfigChange(listener);
    globalThis.dispatchEvent(new Event(CONFIG_CHANGE_EVENT));
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops calling the listener once unsubscribed", () => {
    const listener = vi.fn();
    onConfigChange(listener)();
    globalThis.dispatchEvent(new Event(CONFIG_CHANGE_EVENT));
    expect(listener).not.toHaveBeenCalled();
  });
});
