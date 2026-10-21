import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AuthResult } from "../../runtime/types";

describe("useAuth composable", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns signed-out state when useState returns unauthenticated", async () => {
    vi.doMock("#imports", () => ({
      useState: vi.fn(() => ({
        value: { isAuthenticated: false, session: null } as AuthResult,
      })),
    }));

    const { useAuth } = await import("../../runtime/composables/useAuth");
    const result = useAuth();
    expect(result).toEqual({ isAuthenticated: false, session: null });
  });

  it("returns signed-in state when useState returns authenticated", async () => {
    vi.doMock("#imports", () => ({
      useState: vi.fn(() => ({
        value: {
          isAuthenticated: true,
          session: {
            userId: "nuxt-user",
            identifier: "nuxt@example.com",
            identifierProperty: "email",
            display: "NuxtUser",
            token: "tok123",
          },
        } as AuthResult,
      })),
    }));

    const { useAuth } = await import("../../runtime/composables/useAuth");
    const result = useAuth();
    expect(result.isAuthenticated).toBe(true);
    if (result.isAuthenticated) {
      expect(result.session.userId).toBe("nuxt-user");
      expect(result.session.identifier).toBe("nuxt@example.com");
    }
  });
});

// What an app's page sees: Nuxt declares the auto-import as
// `typeof import("<dist>/runtime/composables/useAuth").useAuth` and compiles
// with `allowJs` and `skipLibCheck`. `sdk-nuxt:test` runs after the build.
// Each probe type-checks a program of its own, which on a loaded CI runner has
// taken longer than Vitest's 5 s default.
describe("useAuth as an app sees it", { timeout: 60_000 }, () => {
  function diagnostics(probe: string): string[] {
    const built = join(import.meta.dirname, "../../../dist/runtime/composables/useAuth");
    const dir = mkdtempSync(join(tmpdir(), "sdk-nuxt-use-auth-"));
    try {
      const file = join(dir, "page.ts");
      writeFileSync(
        file,
        `declare const useAuth: typeof import(${JSON.stringify(built)}).useAuth;\n${probe}\n`,
      );
      const program = ts.createProgram([file], {
        strict: true,
        noEmit: true,
        allowJs: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        types: [],
      });
      return ts
        .getPreEmitDiagnostics(program, program.getSourceFile(file))
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("types the result as the client auth state", () => {
    expect(
      diagnostics(
        "const auth = useAuth();\n" +
          "const signedIn: boolean = auth.isAuthenticated;\n" +
          "const none: null = auth.isAuthenticated ? null : auth.session;\n" +
          "const display: string | null = auth.isAuthenticated ? auth.session.display : null;",
      ),
    ).toEqual([]);
  });

  it("is not assignable to an unrelated type", () => {
    expect(diagnostics("const n: number = useAuth();")).not.toEqual([]);
  });

  it("carries no session token", () => {
    expect(
      diagnostics("const auth = useAuth();\nif (auth.isAuthenticated) auth.session.token;"),
    ).not.toEqual([]);
  });
});
