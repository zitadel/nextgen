// @vitest-environment jsdom
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { _resetConfigForTesting, configureZitadel, type ZitadelProject } from "@zitadel/api/config";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "./index";
import { _resetSessionsForTesting, _sessionEntryCountForTesting } from "./session";

// What the server answers is mapped by getSession() in @zitadel/sdk-core and
// tested there; these cases cover the hook: its states, the shared read and
// refresh.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const signedIn = () =>
  jsonResponse({
    session_id: "s",
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

function Capture({
  projectId,
  onRender,
}: {
  projectId: string;
  onRender: (refresh: () => Promise<void>) => void;
}) {
  const { status, refresh } = useSession({ projectId });
  onRender(refresh);
  return <span>{status}</span>;
}

beforeEach(() => {
  _resetConfigForTesting();
  _resetSessionsForTesting();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetConfigForTesting();
});

describe("useSession()", () => {
  it("is loading until the server answers, then authenticated with the identity", async () => {
    fetchMock.mockResolvedValue(signedIn());
    const project = configureZitadel({ projectId: "proj-1" });

    const { result } = renderHook(() => useSession({ project }));

    expect(result.current).toMatchObject({ status: "loading", session: null, error: null });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.session).toEqual({
      userId: "user-1",
      identifier: "bob@example.com",
      identifierProperty: null,
      display: "Bob",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/__nextgen/api/v1/sessions/me?project_id=proj-1",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("reads the project and proxy path from props without a handle", async () => {
    fetchMock.mockResolvedValue(signedOut());

    const { result } = renderHook(() => useSession({ projectId: "proj-2", proxyPath: "/auth" }));

    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/api/v1/sessions/me?project_id=proj-2",
      expect.anything(),
    );
  });

  it("falls back to the configureZitadel() project", async () => {
    configureZitadel({ projectId: "proj-1" });
    fetchMock.mockResolvedValue(signedIn());

    const { result } = renderHook(() => useSession());

    await waitFor(() => expect(result.current.status).toBe("authenticated"));
  });

  it("reports a failed read as error, never as signed out", async () => {
    configureZitadel({ projectId: "proj-1" });
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, 502));

    const { result } = renderHook(() => useSession());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toMatch(/HTTP 502/);
    expect(result.current.session).toBeNull();
  });

  it("shares one read between every component of the same project", async () => {
    const project = configureZitadel({ projectId: "proj-1" });
    fetchMock.mockResolvedValue(signedIn());
    const { findAllByText } = render(
      <>
        <Name project={project} />
        <Name project={project} />
        <Name project={project} />
      </>,
    );

    expect(await findAllByText("Bob")).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refresh() reads again and updates every component, without showing loading", async () => {
    const project = configureZitadel({ projectId: "proj-1" });
    fetchMock.mockResolvedValueOnce(signedIn()).mockResolvedValueOnce(signedOut());
    const statuses: string[] = [];
    const first = renderHook(() => useSession({ project }));
    const second = renderHook(() => {
      const result = useSession({ project });
      statuses.push(result.status);
      return result;
    });
    await waitFor(() => expect(second.result.current.status).toBe("authenticated"));
    statuses.length = 0;

    await act(() => first.result.current.refresh());

    expect(first.result.current.status).toBe("unauthenticated");
    expect(second.result.current.status).toBe("unauthenticated");
    expect(statuses).not.toContain("loading");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops an answer that a later refresh overtook", async () => {
    const project = configureZitadel({ projectId: "proj-1" });
    let answerFirst: (response: Response) => void = () => {};
    fetchMock
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce(signedOut());
    const { result } = renderHook(() => useSession({ project }));

    await act(() => result.current.refresh());
    expect(result.current.status).toBe("unauthenticated");
    await act(async () => answerFirst(signedIn()));

    expect(result.current.status).toBe("unauthenticated");
  });

  it("renders loading on the server and reads nothing there", () => {
    const project = configureZitadel({ projectId: "proj-1" });
    expect(renderToString(<Status project={project} />)).toContain("loading");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A long-lived server renders many projects; it must not keep one entry per
  // project it ever saw, and refresh() there has nothing to read.
  it("keeps no shared read and refreshes to nothing on the server", async () => {
    vi.stubGlobal("window", undefined);
    let refresh: (() => Promise<void>) | undefined;

    const html = renderToString(<Capture projectId="proj-ssr" onRender={(r) => (refresh = r)} />);

    expect(html).toContain("loading");
    expect(_sessionEntryCountForTesting()).toBe(0);
    await expect(refresh?.()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
