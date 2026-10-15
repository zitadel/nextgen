import {
  CreateIdpBody,
  PatchProjectBody,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  findCredential,
  isSecretKey,
  redactCredentials,
  type References,
} from "../../../../../src/lib/oclif/crud";
import { refuseSecret } from "../../../../../src/lib/oclif/crud/secrets";
import type { ZodLike } from "../../../../../src/lib/oclif/crud/zod";

const references: References = {
  matches: (value) => /^\$\{\{ *\w+ *\}\}$/.test(value),
  example: "'${{ NAME }}'",
};
const connection = (CreateIdpBody as unknown as { shape: { idp: ZodLike } }).shape.idp;

describe("isSecretKey", () => {
  it.each(["password", "api_key", "userToken", "client_secret", "PRIVATE_KEY", "access-token"])(
    "reads %s as a credential's name",
    (key) => {
      expect(isSecretKey(key)).toBe(true);
    },
  );

  it.each(["passwordless", "tokenizer", "email", "display_name"])(
    "does not read %s as one",
    (key) => {
      expect(isSecretKey(key)).toBe(false);
    },
  );

  it.each(["token_endpoint", "token_url", "secret_uri", "revocationEndpoint"])(
    "reads %s as the name of an address, not of a credential",
    (key) => {
      expect(isSecretKey(key)).toBe(false);
    },
  );
});

describe("findCredential", () => {
  it.each(["password", "api_key", "userToken", "client_secret", "PRIVATE_KEY"])(
    "finds %s holding free-form text",
    (key) => {
      expect(findCredential({ attributes: { [key]: "hunter2" } })).toEqual({
        key,
        path: `attributes.${key}`,
      });
    },
  );

  it("finds one in the JSON form too, and inside a list", () => {
    expect(findCredential({ tags: [{ token: "abc" }] })).toEqual({
      key: "token",
      path: "tags.0.token",
    });
  });

  it("finds a value under a credential-named object", () => {
    expect(findCredential({ credentials: { value: "abc" } })).toEqual({
      key: "credentials",
      path: "credentials.value",
    });
  });

  it("leaves keys that merely mention a safe word alone", () => {
    expect(findCredential({ attributes: { passwordless: "true", tokenizer: "v2" } })).toBe(
      undefined,
    );
  });

  it("takes a reference to a variable for no credential", () => {
    expect(
      findCredential({ oidc: { client_secret: "${{ ACME_CLIENT_SECRET }}" } }, { references }),
    ).toBeUndefined();
    // Without the platform's spelling of a reference, nothing is one.
    expect(findCredential({ oidc: { client_secret: "${{ ACME_CLIENT_SECRET }}" } })).toEqual({
      key: "client_secret",
      path: "oidc.client_secret",
    });
  });

  it("takes no boolean or null for a credential", () => {
    expect(findCredential({ id_token_mapping: false, token: null })).toBeUndefined();
  });

  it("takes a value the schema fixes for no credential", () => {
    const schema = connection;
    expect(
      findCredential(
        { oidc: { token_endpoint_auth_method: "client_secret_post", client_secret: "${{ A }}" } },
        { schema, references },
      ),
    ).toBeUndefined();
    // A hashing method's leaves are an enum value and numbers.
    expect(
      findCredential(
        {
          password_hash: { algorithm: "argon2id", params: { time: 3, memory: 65536, threads: 4 } },
        },
        { schema: PatchProjectBody as unknown as ZodLike },
      ),
    ).toBeUndefined();
  });

  it("still finds text the schema leaves free", () => {
    expect(
      findCredential({ oidc: { client_secret: "hunter2" } }, { schema: connection, references }),
    ).toEqual({ key: "client_secret", path: "oidc.client_secret" });
  });

  it("finds a number where the schema does not say it is one", () => {
    expect(findCredential({ attributes: { password: 12345678 } })).toEqual({
      key: "password",
      path: "attributes.password",
    });
  });

  it("finds an enum value no credential could be only when it is one of the values", () => {
    const schema = z.object({ token_kind: z.enum(["opaque", "jwt"]) }) as unknown as ZodLike;
    expect(findCredential({ token_kind: "jwt" }, { schema })).toBeUndefined();
    expect(findCredential({ token_kind: "s3cr3t" }, { schema })).toEqual({
      key: "token_kind",
      path: "token_kind",
    });
  });
});

describe("redactCredentials", () => {
  it("masks a credential that reached the body legitimately, from a file", () => {
    expect(
      redactCredentials({
        schema: "sch_1",
        attributes: { email: "a@b.c", password: "hunter2", tags: [{ token: "t" }] },
      }),
    ).toEqual({
      schema: "sch_1",
      attributes: { email: "a@b.c", password: "«redacted»", tags: [{ token: "«redacted»" }] },
    });
  });

  it("shows references and values the schema fixes, so the preview can be reused", () => {
    const body = {
      idp: {
        oidc: {
          client_secret: "${{ ACME_CLIENT_SECRET }}",
          token_endpoint_auth_method: "client_secret_basic",
          id_token_mapping: false,
          token_endpoint: "https://sso.acme.example/token",
        },
      },
    };
    expect(
      redactCredentials(body, { schema: CreateIdpBody as unknown as ZodLike, references }),
    ).toEqual(body);
  });
});

describe("refuseSecret", () => {
  it("names the reference form when the platform has one", () => {
    expect(() =>
      refuseSecret("client_secret", "--oidc-client-secret", {
        references,
        path: "oidc.client_secret",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: expect.stringContaining(
          'Refusing to read "client_secret" from --oidc-client-secret',
        ),
        hint: expect.stringContaining("'${{ NAME }}'"),
        details: { field: "client_secret", path: "oidc.client_secret" },
      }),
    );
  });
});
