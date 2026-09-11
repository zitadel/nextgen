import {
  GetUserByIDResponse,
  ListEventsResponse,
  QueryTeamsResponse,
  QueryUsersResponse,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { describe, expect, it } from "vitest";

import { allows, fieldPaths, itemSchemaOf, suggestable } from "../../../../../src/lib/oclif/crud";

/** Narrowed once here, so the assertions read without `!` on every line. */
const pathsOf = (schema: Parameters<typeof fieldPaths>[0]) => {
  const paths = fieldPaths(schema);
  if (!paths) {
    throw new Error("expected a readable shape");
  }
  return paths;
};

const userPaths = pathsOf(itemSchemaOf(QueryUsersResponse, "users"));

describe("fieldPaths", () => {
  it("reads a list's record shape through its item array", () => {
    expect(allows(userPaths, "id")).toBe(true);
    expect(allows(userPaths, "identifier")).toBe(true);
    expect(allows(userPaths, "metadata.status")).toBe(true);
    expect(allows(userPaths, "emial")).toBe(false);
    expect(allows(userPaths, "metadata.nope")).toBe(false);
  });

  it("accepts anything under an open record, whose keys the API does not declare", () => {
    // `attributes` is defined by the project's user schema, not the API spec.
    expect(allows(userPaths, "attributes.email")).toBe(true);
    expect(allows(userPaths, "attributes.whateverTheSchemaSays")).toBe(true);
    // The typo is in the known segment, so it is still caught.
    expect(allows(userPaths, "atributes.email")).toBe(false);
  });

  it("reads a record response directly, without an item array", () => {
    const paths = pathsOf(GetUserByIDResponse);
    expect(allows(paths, "metadata.created_at")).toBe(true);
  });

  it("gathers every variant of a union response, since any of them can arrive", () => {
    const paths = pathsOf(itemSchemaOf(ListEventsResponse, "data"));
    expect(allows(paths, "event_type")).toBe(true);
    expect(allows(paths, "category")).toBe(true);
  });

  it("suggests the known paths and marks the open ones", () => {
    const suggestions = suggestable(userPaths);
    expect(suggestions).toContain("metadata.status");
    expect(suggestions).toContain("attributes.<key>");
  });

  it("is undefined for a shape it cannot read, so the caller can fall back", () => {
    expect(fieldPaths(undefined)).toBeUndefined();
    expect(fieldPaths({ safeParse: () => ({ success: true }) })).toBeUndefined();
  });

  it("reads a simpler resource the same way", () => {
    const paths = pathsOf(itemSchemaOf(QueryTeamsResponse, "teams"));
    expect(allows(paths, "name")).toBe(true);
    expect(allows(paths, "nmae")).toBe(false);
  });
});
