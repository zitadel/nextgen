import { describe, expect, it } from "vitest";

import { nuxtCanUseTool } from "../../src/lib/orca/patchers/llm";

describe("nuxtCanUseTool", () => {
  describe("non-Bash tools", () => {
    it("allows Read", () => {
      const result = nuxtCanUseTool("Read", { file_path: "/tmp/foo.ts" });
      expect(result.behavior).toBe("allow");
    });

    it("allows Write", () => {
      const result = nuxtCanUseTool("Write", { file_path: "/tmp/foo.ts" });
      expect(result.behavior).toBe("allow");
    });

    it("allows Edit", () => {
      const result = nuxtCanUseTool("Edit", { file_path: "/tmp/foo.ts" });
      expect(result.behavior).toBe("allow");
    });

    it("allows Glob", () => {
      const result = nuxtCanUseTool("Glob", { pattern: "**/*.ts" });
      expect(result.behavior).toBe("allow");
    });

    it("allows Grep", () => {
      const result = nuxtCanUseTool("Grep", { pattern: "useAuth" });
      expect(result.behavior).toBe("allow");
    });
  });

  describe("Bash — allowed commands", () => {
    it("allows pnpm add", () => {
      const result = nuxtCanUseTool("Bash", {
        command: "pnpm add @zitadel-nextgen/sdk-nuxt@latest",
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows npm install", () => {
      const result = nuxtCanUseTool("Bash", {
        command: "npm install @zitadel-nextgen/sdk-nuxt",
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows yarn add", () => {
      const result = nuxtCanUseTool("Bash", {
        command: "yarn add @zitadel-nextgen/sdk-nuxt",
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows bun add", () => {
      const result = nuxtCanUseTool("Bash", {
        command: "bun add @zitadel-nextgen/sdk-nuxt",
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows tsc --noEmit", () => {
      const result = nuxtCanUseTool("Bash", { command: "tsc --noEmit" });
      expect(result.behavior).toBe("allow");
    });
  });

  describe("Bash — denied commands", () => {
    it("denies rm -rf", () => {
      const result = nuxtCanUseTool("Bash", { command: "rm -rf ." });
      expect(result.behavior).toBe("deny");
    });

    it("denies curl", () => {
      const result = nuxtCanUseTool("Bash", {
        command: "curl https://example.com",
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies arbitrary shell scripts", () => {
      const result = nuxtCanUseTool("Bash", { command: "node -e 'console.log(1)'" });
      expect(result.behavior).toBe("deny");
    });

    it("denies tsc with flags other than --noEmit", () => {
      const result = nuxtCanUseTool("Bash", { command: "tsc --build" });
      expect(result.behavior).toBe("deny");
    });

    it("denies pnpm run dev", () => {
      const result = nuxtCanUseTool("Bash", { command: "pnpm run dev" });
      expect(result.behavior).toBe("deny");
    });
  });
});
