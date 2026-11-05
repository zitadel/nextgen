import { createApp, toWebHandler } from "h3";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { AuthResult, AuthState, NextgenSession, UnauthState } from "../server";

import { createNextgenMiddleware, getAuth } from "../server";

describe("server entry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // A server route imports its helpers and their types from one place, as it
  // does with every other server SDK.
  it("exports the types its helpers answer with", () => {
    expectTypeOf(getAuth).returns.toEqualTypeOf<AuthResult>();
    expectTypeOf<AuthState["session"]>().toEqualTypeOf<NextgenSession>();
    expectTypeOf<UnauthState["session"]>().toEqualTypeOf<null>();
  });

  // `useRuntimeConfig().nextgen.url` is "" until a value sets it, and the
  // documented hand-written middleware passes it straight in.
  it("reads ZITADEL_URL when the middleware is given the empty url the runtime config holds", async () => {
    vi.stubEnv("ZITADEL_URL", "http://runtime.test");
    const upstream = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", upstream);
    const app = createApp();
    app.use(createNextgenMiddleware({ url: "" }));

    await toWebHandler(app)(new Request("http://localhost:3000/__nextgen/flow"));

    expect(upstream).toHaveBeenCalledWith("http://runtime.test/flow", expect.anything());
  });
});
