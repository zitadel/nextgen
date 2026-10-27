import { stripAnsi } from "consola/utils";
import { describe, expect, it } from "vitest";

import { Where } from "../../../../src/lib/ui/where";

const plain = (text: string): string => stripAnsi(text);

describe("Where", () => {
  it("knows nothing when the command reached no server", () => {
    expect(new Where().known).toBe(false);
  });

  it("names the project and the server it ran against", () => {
    expect(plain(new Where("proj-1", "api.zitadel.cloud").render())).toBe(
      "Using project proj-1 on your Zitadel server at api.zitadel.cloud.",
    );
  });

  it("says a server on this machine is the person's own local one", () => {
    expect(plain(new Where("proj-1", "localhost:8080").render())).toContain(
      "your local Zitadel server at localhost:8080",
    );
  });

  it("leaves the project out when the command did not resolve one", () => {
    expect(plain(new Where(undefined, "api.zitadel.cloud").render())).toBe(
      "Using your Zitadel server at api.zitadel.cloud.",
    );
  });

  describe("as the place in a footer that has its own wording", () => {
    it("names the project and the server", () => {
      expect(new Where("proj-1", "api.zitadel.cloud").plain).toBe(
        "project proj-1 on api.zitadel.cloud",
      );
    });

    // `stop` and `doctor` resolve no project, and a bare host after the `·`
    // reads as a column rather than as where the command ran.
    it("still says where it ran when no project was resolved", () => {
      expect(new Where(undefined, "api.zitadel.cloud").plain).toBe("on api.zitadel.cloud");
    });

    // "project proj-1 on your Zitadel project" reads as two different places.
    it("names the project alone when the command reached no server", () => {
      expect(new Where("proj-1").plain).toBe("project proj-1");
    });
  });
});
