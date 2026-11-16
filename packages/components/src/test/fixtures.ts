import { test as base } from "vitest";

/**
 * Puts markup into the test's host element and resolves with its first
 * element once that element has finished rendering.
 *
 * @typeParam T - The type of the markup's first element.
 * @param markup - The HTML to render, whose first element is the one returned.
 * @returns The first element of the markup, after its `updateComplete` settled.
 * @throws If the markup holds no element.
 */
export type Render = <T extends Element = HTMLElement>(markup: string) => Promise<T>;

/**
 * Renders markup into a host element and waits for the component to settle.
 *
 * @param host - The element that receives the markup.
 * @returns The `render` function bound to that host.
 */
function renderInto(host: HTMLElement): Render {
  return async <T extends Element = HTMLElement>(markup: string): Promise<T> => {
    host.innerHTML = markup;
    const element = host.firstElementChild;
    if (element === null) {
      throw new Error("the markup holds no element to render");
    }
    if ("updateComplete" in element) {
      await element.updateComplete;
    }
    return element as T;
  };
}

/**
 * Appends a new `div` to the document body.
 *
 * @returns The attached host element.
 */
function attachHost(): HTMLDivElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

/**
 * `test` with the rendering fixtures: a test that names one in its first
 * argument gets it, and the teardown runs after the test whether it passed or
 * not.
 *
 * - `host` is a `div` attached to the document body, removed when the test ends.
 * - `render` puts markup into `host` and resolves with its first element once
 *   that element finished rendering. A second call replaces the first markup.
 */
export const test = base.extend<{ host: HTMLDivElement; render: Render }>({
  // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
  async host({}, use) {
    const host = attachHost();
    await use(host);
    host.remove();
  },
  async render({ host }, use) {
    await use(renderInto(host));
  },
});

/** The same fixtures as {@link test}, under the name specs import. */
export const it = test;

/**
 * `test` for a spec that keeps one host for the whole file: the host is made
 * when the first test needs it and removed after the last one, and what a test
 * put into it is cleared when that test ends.
 *
 * - `host` is the file's one `div`, attached to the document body.
 * - `render` puts markup into `host` and resolves with its first element once
 *   that element finished rendering.
 */
export const sharedHostTest = base.extend<{
  host: HTMLDivElement;
  render: Render;
  cleared: undefined;
}>({
  host: [
    // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
    async ({}, use) => {
      const host = attachHost();
      await use(host);
      host.remove();
    },
    { scope: "file" },
  ],
  async render({ host }, use) {
    await use(renderInto(host));
  },
  cleared: [
    async ({ host }, use) => {
      await use(undefined);
      host.innerHTML = "";
    },
    { auto: true },
  ],
});

/** The same fixtures as {@link sharedHostTest}, under the name specs import. */
export const sharedHostIt = sharedHostTest;
