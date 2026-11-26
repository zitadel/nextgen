/**
 * The client entry contract: the check every SDK's `./client` entry runs, written
 * once. Each SDK's `client.test.ts` imports its own entry and calls
 * {@link describeClientEntry}.
 */

import * as core from "@zitadel/sdk-core/config";
import { describe, expect, it } from "vitest";

/** The configuration helpers every `./client` entry hands on from `@zitadel/sdk-core/config`. */
const HELPERS = ["configureZitadel", "getApi", "getZitadelConfig"] as const;

/**
 * Asserts that an SDK's `./client` entry exports the shared configuration helpers
 * as the very function objects of `@zitadel/sdk-core/config`, so that a fork with
 * the same name and types cannot take their place.
 *
 * @param entry - The module namespace of the SDK's `./client` entry.
 */
export function describeClientEntry(entry: object): void {
  const exports = entry as Record<string, unknown>;
  const original = core as Record<string, unknown>;

  describe("the client entry", () => {
    it.each(HELPERS)("exports %s as the very function @zitadel/sdk-core/config exports", (name) => {
      expect(exports[name]).toBeTypeOf("function");
      expect(exports[name]).toBe(original[name]);
    });
  });
}
