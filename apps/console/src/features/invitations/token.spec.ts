import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureInvitationToken, clearInvitationToken, readInvitationToken } from "./token";

function page(pathname: string, hash: string, search = "") {
  return { pathname, search, hash };
}

function history() {
  return { state: { key: "k" }, replaceState: vi.fn() };
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("captureInvitationToken", () => {
  it("moves the token into storage and drops the fragment", () => {
    const h = history();
    expect(captureInvitationToken(page("/ui/console/invitations/accept", "#token=tok_1"), h)).toBe(
      true,
    );
    expect(readInvitationToken()).toBe("tok_1");
    // The address keeps its path and nothing of the token, as a path alone:
    // never a query string.
    expect(h.replaceState).toHaveBeenCalledWith({ key: "k" }, "", "/ui/console/invitations/accept");
  });

  it("keeps the rest of the address", () => {
    const h = history();
    captureInvitationToken(page("/invitations/accept/", "#token=tok_1", "?utm_source=mail"), h);
    expect(h.replaceState).toHaveBeenCalledWith(
      { key: "k" },
      "",
      "/invitations/accept/?utm_source=mail",
    );
  });

  it("leaves a fragment on any other page alone", () => {
    const h = history();
    expect(captureInvitationToken(page("/users", "#token=tok_1"), h)).toBe(false);
    expect(readInvitationToken()).toBeUndefined();
    expect(h.replaceState).not.toHaveBeenCalled();
  });

  it("keeps a stored token when the page is reopened without one", () => {
    captureInvitationToken(page("/invitations/accept", "#token=tok_1"), history());
    const h = history();
    captureInvitationToken(page("/invitations/accept", ""), h);
    expect(readInvitationToken()).toBe("tok_1");
    expect(h.replaceState).not.toHaveBeenCalled();
  });

  it("takes the newer link's token", () => {
    captureInvitationToken(page("/invitations/accept", "#token=tok_1"), history());
    captureInvitationToken(page("/invitations/accept", "#token=tok_2"), history());
    expect(readInvitationToken()).toBe("tok_2");
  });
});

describe("clearInvitationToken", () => {
  it("forgets the token", () => {
    captureInvitationToken(page("/invitations/accept", "#token=tok_1"), history());
    clearInvitationToken();
    expect(readInvitationToken()).toBeUndefined();
  });
});
