import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { Stdin } from "@/lib/stdin";

describe("Stdin.read", () => {
  const streamOf = (...chunks: string[]) => {
    return Readable.from(chunks);
  };

  it("joins chunks", async () => {
    expect(await Stdin.on(streamOf("abc", "def")).read()).toBe("abcdef");
  });

  it("strips exactly one trailing newline", async () => {
    expect(await Stdin.on(streamOf("secret\n")).read()).toBe("secret");
    expect(await Stdin.on(streamOf("secret\n\n")).read()).toBe("secret\n");
    expect(await Stdin.on(streamOf("secret\r\n")).read()).toBe("secret");
  });

  it("keeps a leading byte-order mark, which is part of what was piped", async () => {
    expect(await Stdin.on(streamOf("\uFEFFsecret\n")).read()).toBe("\uFEFFsecret");
  });

  it("keeps interior whitespace", async () => {
    expect(await Stdin.on(streamOf("a b\tc")).read()).toBe("a b\tc");
  });
});
