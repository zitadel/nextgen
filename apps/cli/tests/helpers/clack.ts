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

/** What a scripted person does when they run out of answers: they walk away. */
const WALKED_AWAY = Symbol("walked away");

/**
 * A person at the prompts of a {@link clackDouble}. Each prompt a command draws
 * takes the next of `queue` as its answer, whichever kind of prompt it is: a
 * string for a text or password, a boolean for a confirm, the chosen value for
 * a select, an array for a multiselect. When the queue is empty the person
 * walks away, which is a cancel.
 *
 * @param clack - The double the suite mocked `@clack/prompts` with.
 * @param queue - The answers, in the order they are asked for.
 * @returns What was asked, in order, as `asked()`; every prompt's options too, as `options()`.
 */
export function answering(
  clack: ReturnType<typeof clackDouble>,
  ...queue: unknown[]
): { asked(): string[]; options(): unknown[] } {
  const asked: string[] = [];
  const options: unknown[] = [];
  const answer = async (prompt: { message: string; options?: unknown }): Promise<unknown> => {
    asked.push(prompt.message);
    options.push(prompt.options);
    return queue.length === 0 ? WALKED_AWAY : queue.shift();
  };
  for (const prompt of [
    clack.text,
    clack.password,
    clack.confirm,
    clack.select,
    clack.multiselect,
  ]) {
    prompt.mockImplementation(answer);
  }
  clack.isCancel.mockImplementation((value: unknown) => value === WALKED_AWAY);
  return { asked: () => asked, options: () => options };
}
