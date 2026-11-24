// @vitest-environment jsdom
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { _resetConfigForTesting, configureZitadel, type ZitadelProject } from "@zitadel/api/config";
import { _resetSessionStoresForTesting } from "@zitadel/sdk-core/session";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "./index";

// The store behind the hook (sharing, ordering, failures, lifetime) is tested
// in @zitadel/sdk-core's session-store.spec.ts; these cases cover the React
// binding.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const signedIn = () =>
  jsonResponse({
    project_id: "proj-1",
    user_id: "user-1",
    user: { user_id: "user-1", identifier: "bob@example.com", display: "Bob" },
  });
const signedOut = () => jsonResponse({ code: "auth.unauthorized", message: "No session" }, 401);

const fetchMock = vi.fn<typeof fetch>();

function Name({ project }: { project: ZitadelProject }) {
  const { session } = useSession({ project });
  return <span>{session?.display ?? "…"}</span>;
}

function Status({ project }: { project: ZitadelProject }) {
  return <span>{useSession({ project }).status}</span>;
}

beforeEach(() => {
  _resetConfigForTesting();
  _resetSessionStoresForTesting();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetConfigForTesting();
});

describe("useSession()", () => {
  it("renders loading, then the server's answer", async () => {
    fetchMock.mockResolvedValue(signedIn());
    const project = configureZitadel({ projectId: "proj-1" });

    const { result } = renderHook(() => useSession({ project }));

    expect(result.current).toMatchObject({ status: "loading", session: null, error: null });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.session).toMatchObject({ userId: "user-1", display: "Bob" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/__nextgen/api/v1/sessions/me?project_id=proj-1",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("shares one read between every component of the same project", async () => {
    const project = configureZitadel({ projectId: "proj-1" });
    fetchMock.mockResolvedValue(signedIn());

    const { findAllByText } = render(
      <StrictMode>
        <Name project={project} />
        <Name project={project} />
        <Name project={project} />
      </StrictMode>,
    );

    expect(await findAllByText("Bob")).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refresh() updates every component and resolves with the new snapshot", async () => {
    const project = configureZitadel({ projectId: "proj-1" });
    fetchMock.mockResolvedValueOnce(signedIn()).mockResolvedValueOnce(signedOut());
    const first = renderHook(() => useSession({ project }));
    const second = renderHook(() => useSession({ project }));
    await waitFor(() => expect(second.result.current.status).toBe("authenticated"));

    let snapshot: unknown;
    await act(async () => {
      snapshot = await first.result.current.refresh();
    });

    expect(snapshot).toMatchObject({ status: "unauthenticated" });
    expect(first.result.current.status).toBe("unauthenticated");
    expect(second.result.current.status).toBe("unauthenticated");
  });

  it("renders loading on the server and reads nothing there", () => {
    const project = configureZitadel({ projectId: "proj-1" });

    expect(renderToString(<Status project={project} />)).toContain("loading");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
