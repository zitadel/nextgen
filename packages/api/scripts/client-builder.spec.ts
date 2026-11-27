import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import type * as endpoints from "../src/generated/endpoints/zitadelNextGen";
import { getProject, getSchema, getUser } from "../src/generated/endpoints/zitadelNextGen";
import type { OperationName } from "../src/runtime/api-factory";
import { ZitadelClient } from "../src/runtime/client";
import { substituteOnce } from "./client-builder";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

/** A local server that answers `{}` and records each request's raw path. */
async function paths(): Promise<{ base: string; seen: string[] }> {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(req.url ?? "");
    res.setHeader("content-type", "application/json");
    res.end("{}");
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

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
    const client = new ZitadelClient({ baseUrl: "http://127.0.0.1:1" });

    // @ts-expect-error -- an operation called without its client does not compile.
    const without = () => getProject("proj_1");
    // @ts-expect-error -- nor with an object that only looks like a client.
    const lookalike = () => getProject({ baseUrl: "http://127.0.0.1:1" }, "proj_1");
    const with_ = () => getProject(client, "proj_1");

    expect([without, lookalike, with_]).toHaveLength(3);
  });
});

describe("the generated module", () => {
  it("exports operations and nothing else, so no URL builder is public", () => {
    expectTypeOf<keyof typeof endpoints>().toEqualTypeOf<OperationName>();
  });

  it("encodes a path parameter and leaves the base URL as it is", async () => {
    const { base, seen } = await paths();
    const client = new ZitadelClient({ baseUrl: base });

    await getUser(client, "usr_01");

    expect(seen).toEqual(["/api/v1/users/usr_01"]);
  });

  it.each([
    [
      "https://zitadel.com/schemas/v1/default-human-user.json",
      "https%3A%2F%2Fzitadel.com%2Fschemas%2Fv1%2Fdefault-human-user.json",
    ],
    ["urn:example:human", "urn%3Aexample%3Ahuman"],
    ["with space", "with%20space"],
    ["a/b", "a%2Fb"],
  ])("sends the schema id %j as one path segment", async (id, encoded) => {
    const { base, seen } = await paths();
    const client = new ZitadelClient({ baseUrl: base });

    await getSchema(client, id);

    expect(seen).toEqual([`/api/v1/schemas/${encoded}`]);
  });
});
