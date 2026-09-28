/**
 * Design-review fixture data, taken from the Figma mockups.
 *
 * **Dev-only.** Nothing outside `src/dev/fixtures/` imports this file, and that
 * folder is only loaded from `main.tsx` behind `import.meta.env.DEV &&
 * VITE_CONSOLE_FIXTURES` — production builds never contain it.
 *
 * Sources:
 *   - Projects directory 1431:148690, project detail 1433:185564
 *   - Teams directory 1433:186168, team detail 1447:265352
 *   - User directory 2291:54604, user detail 2291:58110 / 2291:58170
 *   - Flows directory 1985:63428 (names, purposes, schemas, dates)
 *
 * Where a frame repeats one placeholder row (the user directory lists "Maya
 * Patel" eleven times), the first row is kept verbatim and the rest are varied
 * so the table reads as real data.
 *
 * Every record is a wire-shaped response body, as the orval client parses it.
 */

import { MAINTAINED_FONT_FAMILY, maintainedPalette } from "@/lib/branding-defaults";

type Json = Record<string, unknown>;

/** The Figma "acme-app" project stands in for the pinned dev project, when there is one. */
export const ACME_APP_ID = import.meta.env.VITE_CONSOLE_PROJECT_ID || "proj_acme_app";

function at(date: string, time = "09:00:00"): string {
  return `${date}T${time}Z`;
}

function project(id: string, name: string, date: string): Json {
  return { id, name, created_at: at(date), updated_at: at(date) };
}

export const PROJECTS: Json[] = [
  project(ACME_APP_ID, "acme-app", "2026-07-12"),
  project("proj_breeze", "Breeze", "2026-07-08"),
  project("proj_stand", "Stand", "2026-07-08"),
  project("proj_prism", "Prism", "2026-04-06"),
  project("proj_ember", "Ember", "2025-02-16"),
  project("proj_circuit", "Circuit", "2025-01-15"),
  project("proj_solstice", "Solstice", "2025-04-25"),
  project("proj_horizon", "Horizon", "2025-05-14"),
  project("proj_onyx", "Onyx", "2026-04-17"),
  project("proj_pinnacle", "Pinnacle", "2025-08-07"),
  project("proj_vertex", "Vertex", "2025-07-16"),
  project("proj_quasar", "Quasar", "2025-07-16"),
];

function team(id: string, name: string, status: "active" | "deactivated"): Json {
  return { id, name, status, created_at: at("2026-07-08"), updated_at: at("2026-07-08") };
}

/** Acme Web and Acme Mobile from the directory; River is the team the user rows name. */
export const TEAMS: Json[] = [
  team("team_8f2a1c94", "Acme Web", "active"),
  team("team_river", "River", "active"),
  team("team_acme_mobile", "Acme Mobile", "deactivated"),
];

function schema(id: string, title: string, properties: Json, date: string): Json {
  return {
    id,
    metadata: { created_at: at(date) },
    schema: {
      title,
      type: "object",
      objectType: "human-user",
      "x-auth-methods": { password: { enabled: true }, passkey: { enabled: true } },
      required: ["email"],
      properties,
    },
  };
}

const EMAIL = { type: "string", format: "email", title: "Email address" };
const GIVEN_NAME = { type: "string", title: "First name" };
const FAMILY_NAME = { type: "string", title: "Last name" };

/** The three schemas the Login flows table names: Minimal, Consumer, Business. */
export const SCHEMAS: Json[] = [
  schema("sch_minimal", "Minimal", { email: EMAIL }, "2026-07-01"),
  schema(
    "sch_consumer",
    "Consumer",
    { email: EMAIL, givenName: GIVEN_NAME, familyName: FAMILY_NAME },
    "2026-07-01",
  ),
  schema(
    "sch_business",
    "Business",
    {
      email: EMAIL,
      givenName: GIVEN_NAME,
      familyName: FAMILY_NAME,
      companyName: { type: "string", title: "Company Name" },
    },
    "2026-07-01",
  ),
];

const RIVER = { id: "team_river", name: "River" };
const ACME_WEB = { id: "team_8f2a1c94", name: "Acme Web" };

interface UserSeed {
  id: string;
  schema: "sch_minimal" | "sch_consumer" | "sch_business";
  email: string;
  givenName?: string;
  familyName?: string;
  companyName?: string;
  status?: "active" | "suspended" | "deactivated";
  created?: string;
  teams?: Json[];
}

function user(seed: UserSeed): Json {
  const { id, schema: schemaId, email, givenName, familyName, companyName } = seed;
  const display = [givenName, familyName].filter(Boolean).join(" ") || undefined;
  const created = at(seed.created ?? "2026-07-08");
  return {
    id,
    schema: schemaId,
    identifier: email,
    identifier_property: "email",
    ...(display ? { display } : {}),
    attributes: {
      email,
      ...(givenName ? { givenName } : {}),
      ...(familyName ? { familyName } : {}),
      ...(companyName ? { companyName } : {}),
    },
    metadata: { status: seed.status ?? "active", created_at: created, updated_at: created },
    teams: seed.teams ?? [RIVER],
  };
}

export const USERS: Json[] = [
  user({
    id: "usr_8f2a1c94",
    schema: "sch_business",
    email: "maya.patel@acme.com",
    givenName: "Maya",
    familyName: "Patel",
    companyName: "Acme Corp",
    created: "2026-07-12",
  }),
  user({
    id: "usr_alex_morgan",
    schema: "sch_business",
    email: "alex.morgan@acme.com",
    givenName: "Alex",
    familyName: "Morgan",
    companyName: "Acme Corp",
    teams: [RIVER, ACME_WEB],
  }),
  user({
    id: "usr_priya_raman",
    schema: "sch_business",
    email: "priya.raman@acme.com",
    givenName: "Priya",
    familyName: "Raman",
    companyName: "Acme Corp",
  }),
  user({
    id: "usr_lena_fischer",
    schema: "sch_business",
    email: "lena.fischer@acme.com",
    givenName: "Lena",
    familyName: "Fischer",
    companyName: "Acme Corp",
    teams: [ACME_WEB],
  }),
  user({
    id: "usr_noah_kim",
    schema: "sch_business",
    email: "noah.kim@seaindustries.com",
    givenName: "Noah",
    familyName: "Kim",
    companyName: "Sea Industries",
  }),
  user({
    id: "usr_sofia_rossi",
    schema: "sch_business",
    email: "sofia.rossi@seaindustries.com",
    givenName: "Sofia",
    familyName: "Rossi",
    companyName: "Sea Industries",
    status: "suspended",
  }),
  user({
    id: "usr_jonas_weber",
    schema: "sch_consumer",
    email: "jonas.weber@mail.com",
    givenName: "Jonas",
    familyName: "Weber",
  }),
  user({
    id: "usr_amara_okafor",
    schema: "sch_consumer",
    email: "amara.okafor@mail.com",
    givenName: "Amara",
    familyName: "Okafor",
    teams: [],
  }),
  user({
    id: "usr_sam_lee",
    schema: "sch_minimal",
    email: "sam.lee@partner.io",
    status: "deactivated",
    teams: [],
  }),
];

/** User detail › Authentication (2291:58170): password and passkey, verified 28 Apr 2026. */
export const PASSKEYS: Json[] = [
  { id: "pk_macbook", name: "MacBook Pro", created_at: at("2026-04-28", "15:32:00") },
];

function adminGrant(id: string, userId: string): Json {
  const person = USERS.find((entry) => entry.id === userId) ?? {};
  const { id: _id, teams: _teams, ...rest } = person;
  return {
    id,
    project_id: ACME_APP_ID,
    object_type: "project",
    relation: "admin",
    created_at: at("2026-07-12"),
    user: { user_id: userId, ...rest },
  };
}

/** Project settings › Admins. */
export const GRANTS: Json[] = [
  adminGrant("asgn_maya", "usr_8f2a1c94"),
  adminGrant("asgn_alex", "usr_alex_morgan"),
  adminGrant("asgn_priya", "usr_priya_raman"),
];

function flow(id: string, name: string, purposes: Json, userSchema: string, steps: Json[]): Json {
  return {
    id,
    project_id: ACME_APP_ID,
    created_at: at("2026-07-01"),
    updated_at: at("2026-07-08"),
    flow_definition: { name, status: "active", user_schema: userSchema, purposes, steps },
  };
}

export const FLOW_DEFINITIONS: Json[] = [
  flow(
    "flow_default_login",
    "default-login",
    { login: "identifier", register: "register" },
    "sch_minimal",
    [
      {
        name: "identifier",
        fields: ["email"],
        actions: [
          { name: "submit", kind: "submit" },
          { name: "passkey", kind: "passkey" },
        ],
      },
      { name: "password", actions: [{ name: "submit", kind: "submit" }] },
      { name: "register", fields: ["email"], actions: [{ name: "submit", kind: "submit" }] },
    ],
  ),
  flow("flow_password_login", "password-login", { login: "identifier" }, "sch_consumer", [
    { name: "identifier", fields: ["email"], actions: [{ name: "submit", kind: "submit" }] },
    { name: "password", actions: [{ name: "submit", kind: "submit" }] },
  ]),
  flow("flow_passkey_login", "passkey-login", { login: "identifier" }, "sch_business", [
    { name: "identifier", fields: ["email"], actions: [{ name: "passkey", kind: "passkey" }] },
    { name: "passkey-upsell" },
  ]),
];

/** One published revision, in the design system's own maintained values. */
export const BRANDING: Json = {
  id: "brnd_acme",
  created_at: at("2026-07-08"),
  branding: {
    typography: { font_family: MAINTAINED_FONT_FAMILY },
    shape: { radius: "md", density: "regular" },
    theme: {
      mode: "auto",
      light: { palette: maintainedPalette("light") },
      dark: { palette: maintainedPalette("dark") },
    },
  },
};
