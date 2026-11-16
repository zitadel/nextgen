import { act, renderHook } from "@testing-library/react";
import { describe, expect, vi } from "vitest";

import { it, type Clock } from "@/test/clock.fixture";

import { TYPING_PAUSE_MS } from "./use-debounced";
import { useSearchDraft } from "./use-search-draft";

/** The hook over a committed value the test moves, as navigation moves the URL. */
function renderDraft(initial: string, clock: Clock) {
  const write = vi.fn();
  const hook = renderHook(({ committed }) => useSearchDraft(committed, write), {
    initialProps: { committed: initial },
  });
  return {
    write,
    draft: () => hook.result.current[0],
    type: (text: string) => act(() => hook.result.current[1](text)),
    pause: () => act(() => clock.advance(TYPING_PAUSE_MS)),
    commit: (committed: string) => hook.rerender({ committed }),
  };
}

describe("useSearchDraft", () => {
  it("writes the trimmed draft once typing pauses, once", ({ clock }) => {
    const field = renderDraft("", clock);
    field.type("ac");
    field.type("acme ");
    expect(field.write).not.toHaveBeenCalled();

    field.pause();
    expect(field.write.mock.calls).toEqual([["acme"]]);
  });

  it("keeps what was typed since when its own write lands", ({ clock }) => {
    const field = renderDraft("", clock);
    field.type("acme");
    field.pause();
    field.type("acme c");

    field.commit("acme");
    expect(field.draft()).toBe("acme c");
  });

  it("takes a value committed from elsewhere, and never writes the old draft back", ({ clock }) => {
    const field = renderDraft("", clock);
    field.type("acme");
    field.pause();
    field.commit("acme");

    // A link that clears the search.
    field.commit("");
    expect(field.draft()).toBe("");
    field.pause();
    expect(field.write.mock.calls).toEqual([["acme"]]);
  });
});
