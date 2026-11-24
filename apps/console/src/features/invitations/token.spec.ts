import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureInvitationToken,
  clearInvitationToken,
  handOverInvitationToken,
  holdInvitationTokenFor,
  readInvitationToken,
} from "./token";

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

describe("holdInvitationTokenFor", () => {
  const open = (token = "tok_1") =>
    captureInvitationToken(page("/invitations/accept", `#token=${token}`), history());

  it("gives the token to the first person, and to them again", () => {
    open();
    expect(holdInvitationTokenFor("user_a")).toBe("tok_1");
    expect(holdInvitationTokenFor("user_a")).toBe("tok_1");
  });

  it("forgets the token for anyone who signs in after its holder", () => {
    open();
    holdInvitationTokenFor("user_a");
    expect(holdInvitationTokenFor("user_b")).toBeUndefined();
    expect(readInvitationToken()).toBeUndefined();
    // Gone for the first person too: nothing is left on the tab.
    expect(holdInvitationTokenFor("user_a")).toBeUndefined();
  });

  it("gives it to the next person once the holder hands it over", () => {
    open();
    holdInvitationTokenFor("user_a");
    handOverInvitationToken();
    expect(holdInvitationTokenFor("user_b")).toBe("tok_1");
  });

  it("has no holder for a link opened after another", () => {
    open();
    holdInvitationTokenFor("user_a");
    open("tok_2");
    expect(holdInvitationTokenFor("user_b")).toBe("tok_2");
  });

  it("has nothing without a token", () => {
    expect(holdInvitationTokenFor("user_a")).toBeUndefined();
  });
});
