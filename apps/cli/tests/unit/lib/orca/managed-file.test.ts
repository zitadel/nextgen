import { describe, expect, it } from "vitest";

import { ManagedFile } from "@/lib/orca/managed-file";

describe("ManagedFile.MARKER", () => {
  it("is the versioned managed-file sentinel comment", () => {
    expect(ManagedFile.MARKER).toBe("// zitadel-cli: managed-file v1");
  });
});

describe("ManagedFile.isManaged", () => {
  it("recognises a file that carries the marker anywhere", () => {
    expect(new ManagedFile(`${ManagedFile.MARKER}\nexport {};\n`).isManaged()).toBe(true);
    expect(new ManagedFile(`<!-- ${ManagedFile.MARKER} -->\n<p></p>\n`).isManaged()).toBe(true);
  });

  it("does not recognise a file written by hand", () => {
    expect(new ManagedFile("export {};\n").isManaged()).toBe(false);
    expect(new ManagedFile("// zitadel-cli: managed-file v2\n").isManaged()).toBe(false);
  });
});
