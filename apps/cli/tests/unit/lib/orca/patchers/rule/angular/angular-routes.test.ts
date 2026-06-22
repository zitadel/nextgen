import { describe, expect, it } from "vitest";

import { angularRoutesEdit } from "../../../../../../../src/lib/orca/patchers/rule/angular/angular-routes";

const edit = angularRoutesEdit();

describe("angularRoutesEdit", () => {
  it("adds componentless auth routes to the default Angular route table", () => {
    const out = edit("import { Routes } from '@angular/router';\n\nexport const routes: Routes = [];\n");
    expect(out).toContain('path: "login"');
    expect(out).toContain('path: "register"');
    expect(out).toContain('path: "profile"');
    expect(out).toContain("children: []");
  });

  it("preserves existing routes and only adds missing auth paths", () => {
    const out = edit(
      [
        "import { Routes } from '@angular/router';",
        "",
        "export const routes: Routes = [{ path: 'login', component: LoginPage }, { path: 'settings', component: SettingsPage }];",
        "",
      ].join("\n"),
    );
    expect(out).toContain("component: LoginPage");
    expect(out).toContain("component: SettingsPage");
    expect(out.match(/path: "login"|path: 'login'/g)).toHaveLength(1);
    expect(out).toContain('path: "register"');
    expect(out).toContain('path: "profile"');
  });

  it("returns the source untouched when all auth routes already exist", () => {
    const source = [
      "import { Routes } from '@angular/router';",
      "",
      "export const routes: Routes = [{ path: 'login', children: [] }, { path: 'register', children: [] }, { path: 'profile', children: [] }];",
      "",
    ].join("\n");
    expect(edit(source)).toBe(source);
  });

  it("throws a validation error when routes is not an inline array", () => {
    expect(() =>
      edit(
        [
          "import { Routes } from '@angular/router';",
          "const appRoutes = [];",
          "export const routes: Routes = appRoutes;",
          "",
        ].join("\n"),
      ),
    ).toThrowError(/Cannot wire Angular auth routes/);
  });
});
