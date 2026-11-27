import { describe, expect, it } from "vitest";

import { getProject } from "../src/generated/endpoints/zitadelNextGen";
import { ZitadelClient } from "../src/runtime/client";
import { substituteOnce } from "./client-builder";

/** One operation as orval's fetch client writes it. */
const operation = `export const getThing = async (client: ZitadelClient,
    thingId: string, options?: Parameters<typeof customFetch>[1]): Promise<GetThing200> => {

  return customFetch<GetThing200>(getGetThingUrl(thingId),
  {
    ...options,
    method: 'GET'
  }
);}`;

const SUBSTITUTIONS = [
  { find: "customFetch<", replace: 'customFetch(client, "getThing")<' },
  { find: "Parameters<typeof customFetch>[1]", replace: "RequestInit" },
] as const;

describe("substituteOnce", () => {
  it("hands the client and the operation's name to the transport", () => {
    const source = substituteOnce("getThing", operation, SUBSTITUTIONS);

    expect(source).toContain('return customFetch(client, "getThing")<GetThing200>(');
    expect(source).toContain("options?: RequestInit");
  });

  it("fails generation when orval no longer writes the mutator call", () => {
    const changed = operation.replace("customFetch<GetThing200>", "fetchWith<GetThing200>");

    expect(() => substituteOnce("getThing", changed, SUBSTITUTIONS)).toThrow(
      "getThing: expected `customFetch<` once in the generated operation, found it 0 times",
    );
  });

  it("fails generation when the mutator call appears more than once", () => {
    const twice = `${operation}\n${operation}`;

    expect(() => substituteOnce("getThing", twice, SUBSTITUTIONS)).toThrow(
      "getThing: expected `customFetch<` once in the generated operation, found it 2 times",
    );
  });
});

describe("the generated operations", () => {
  it("take the client as a required first argument", () => {
    const client = new ZitadelClient({ baseUrl: "http://127.0.0.1:1", allowDestructive: false });

    // @ts-expect-error -- an operation called without its client does not compile.
    const without = () => getProject("proj_1");
    // @ts-expect-error -- nor with an object that only looks like a client.
    const lookalike = () => getProject({ baseUrl: "http://127.0.0.1:1" }, "proj_1");
    const with_ = () => getProject(client, "proj_1");

    expect([without, lookalike, with_]).toHaveLength(3);
  });
});
