import { vi } from "vitest";

/**
 * A stand-in for `@clack/prompts`, for a unit test that drives a command's
 * prompts: `vi.mock("@clack/prompts", async () => (await import("<here>")).clackDouble())`.
 * Every prompt is a mock the test answers, and nothing is cancelled until it
 * says so. `lib/input.ts` is the only module that asks, so a double of this
 * package is a double of the one function.
 */
export function clackDouble() {
  return {
    confirm: vi.fn(),
    select: vi.fn(),
    multiselect: vi.fn(),
    text: vi.fn(),
    password: vi.fn(),
    cancel: vi.fn(),
    isCancel: vi.fn().mockReturnValue(false),
    intro: vi.fn(),
    outro: vi.fn(),
    note: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), message: vi.fn() },
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), clear: vi.fn(), message: vi.fn() })),
  };
}
