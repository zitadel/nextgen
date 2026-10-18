import { describe, expect, it } from "vitest";

import * as client from "../client";
import * as index from "../index";
import * as server from "../server";

/**
 * `@zitadel/sdk-sveltekit` is server-only: the `<zitadel-*>` widgets come from
 * `@zitadel/sdk-svelte`, whose specs check every config key against the element.
 * If an entry here ever exports a widget wrapper, it needs the same
 * "wrapper config parity" checks, so this fails until they are added.
 */
describe("wrapper config parity", () => {
  it("exports no <zitadel-login>, <zitadel-session> or <zitadel-logout> wrapper", () => {
    const wrappers = Object.entries({ index, client, server }).flatMap(([entry, exports]) =>
      Object.keys(exports)
        .filter((name) => /^Zitadel(Login|Session|Logout)/.test(name))
        .map((name) => `${entry}:${name}`),
    );
    expect(wrappers).toEqual([]);
  });
});
