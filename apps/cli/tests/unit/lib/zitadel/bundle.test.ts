import { describe, expect, it } from "vitest";

import { toBundle } from "@/lib/zitadel/bundle";
import { ZitadelConfig } from "@/lib/zitadel/config";
import { MemoryStore } from "@/lib/zitadel/storage";
import type { ConfigFile, ConfigFiles } from "@/lib/zitadel/types";

function configOf(files: Partial<ConfigFiles>): ZitadelConfig {
  return ZitadelConfig.of({
    schemas: [],
    flows: [],
    connections: [],
    policies: [],
    branding: [],
    ...files,
  });
}

describe("toBundle", () => {
  it("groups the resources by kind and strips the $schema affordance", () => {
    const config = configOf({
      schemas: [
        {
          path: ".zitadel/schemas/human-user.json",
          body: { $schema: "../meta/user-schema.json", objectType: "human-user" },
        },
      ],
      flows: [
        {
          path: ".zitadel/flows/default-login.json",
          body: { $schema: "../meta/flow-definition.json", name: "default-login" },
        },
      ],
      connections: [
        {
          path: ".zitadel/idps/google.json",
          body: { $schema: "../meta/idp.json", slug: "google" },
        },
      ],
    });

    const { bundle, resourceCount } = toBundle(config, new MemoryStore());

    expect(resourceCount).toBe(3);
    expect(bundle.schemas).toEqual([{ objectType: "human-user" }]);
    expect(bundle.flow_definitions).toEqual([{ name: "default-login" }]);
    expect(bundle.idps).toEqual([{ slug: "google" }]);
    expect(bundle.branding).toBeUndefined();
  });

  it("sends the branding as one object under `branding`, never a `brandings` list", () => {
    const config = configOf({
      schemas: [{ path: ".zitadel/schemas/human-user.json", body: { objectType: "human-user" } }],
      branding: [{ path: ".zitadel/branding/branding.json", body: { layout: "centered" } }],
    });

    const { bundle, resourceCount } = toBundle(config, new MemoryStore());

    expect(resourceCount).toBe(2);
    expect(bundle.branding).toMatchObject({ layout: "centered" });
    expect(bundle).not.toHaveProperty("brandings");
  });

  it("inlines the branding's $file template and drops its $schema pointer", () => {
    const store = new MemoryStore([], { ".zitadel/branding/login.liquid": "<main></main>" });
    const config = configOf({
      branding: [
        {
          path: ".zitadel/branding/branding.json",
          body: { $schema: "../meta/branding.json", liquid_template: { $file: "./login.liquid" } },
        },
      ],
    });

    const { bundle } = toBundle(config, store);

    expect(bundle.branding).toEqual({ liquid_template: "<main></main>" });
  });

  it("carries policy files under `policies` without their $schema pointer", () => {
    const config = configOf({
      policies: [
        {
          path: ".zitadel/policies/auth.factor.password.set.json",
          body: {
            $schema: "../meta/policy.json",
            operation: "auth.factor.password.set",
            config: { min_length: 12 },
          },
        },
      ],
    });

    const { bundle, resourceCount } = toBundle(config, new MemoryStore());

    expect(resourceCount).toBe(1);
    expect(bundle.policies).toEqual([
      { operation: "auth.factor.password.set", config: { min_length: 12 } },
    ]);
  });

  it("never carries a policy test file, valid or not", () => {
    const config = configOf({
      policies: [
        {
          path: ".zitadel/policies/auth.factor.password.set.json",
          body: { operation: "auth.factor.password.set", config: {} },
        },
        {
          path: ".zitadel/policies/auth.factor.password.set.test.json",
          body: { cases: "not a policy" },
        },
      ],
    });

    const { bundle, resourceCount } = toBundle(config, new MemoryStore());

    expect(resourceCount).toBe(1);
    expect(bundle.policies).toEqual([{ operation: "auth.factor.password.set", config: {} }]);
  });

  it("leaves `policies` out when there are none, so a server without the kind takes it", () => {
    const config = configOf({
      schemas: [{ path: ".zitadel/schemas/human-user.json", body: { objectType: "human-user" } }],
    });

    const { bundle } = toBundle(config, new MemoryStore());

    expect(bundle).not.toHaveProperty("policies");
  });

  it("refuses an empty configuration", () => {
    expect(() => {
      return toBundle(ZitadelConfig.empty(), new MemoryStore());
    }).toThrow(
      expect.objectContaining({
        name: "ConfigError",
        message: "There is nothing in .zitadel/ to deploy",
      }),
    );
  });

  it("refuses more than one branding descriptor", () => {
    const config = configOf({
      branding: [
        { path: ".zitadel/branding/one.json", body: { name: "one" } },
        { path: ".zitadel/branding/two.json", body: { name: "two" } },
      ],
    });

    expect(() => {
      return toBundle(config, new MemoryStore());
    }).toThrow(
      expect.objectContaining({
        name: "ConfigError",
        message: "A release carries at most one branding, but .zitadel/branding/ holds 2",
      }),
    );
  });

  it("refuses a bundle over the fifty-resource cap", () => {
    const schemas: ConfigFile[] = Array.from({ length: 51 }, (_, i) => {
      return { path: `.zitadel/schemas/schema-${i}.json`, body: { objectType: `type-${i}` } };
    });

    expect(() => {
      return toBundle(configOf({ schemas }), new MemoryStore());
    }).toThrow(
      expect.objectContaining({
        name: "ConfigError",
        message: "A release pins at most 50 resources, but .zitadel/ holds 51",
      }),
    );
  });

  it("takes exactly fifty resources", () => {
    const schemas: ConfigFile[] = Array.from({ length: 50 }, (_, i) => {
      return { path: `.zitadel/schemas/schema-${i}.json`, body: { objectType: `type-${i}` } };
    });

    const { resourceCount } = toBundle(configOf({ schemas }), new MemoryStore());

    expect(resourceCount).toBe(50);
  });
});
