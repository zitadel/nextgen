#!/usr/bin/env node
// Seeds the Zitadel v4 instance started by start-v4.sh through v4's own APIs:
// orgs in every state, human users with plaintext and imported password
// hashes in every user state, OIDC and other IdPs with user links, and some
// inventory (machine user, project, app, authorization, action target).
//
// Not idempotent: it exits with code 2, before writing anything, when the org
// "Acme" already exists. To seed again, reset the database (README.md).
//
// Env: V4_PORT (58080), V4_URL (http://localhost:$V4_PORT),
//      V4_DATA_DIR (${TMPDIR:-/tmp}/zitadel-v4demo), V4_PAT_FILE
//      ($V4_DATA_DIR/admin.pat).
// Progress goes to stderr; the JSON summary goes to stdout and to
// $V4_DATA_DIR/seed-summary.json.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const port = process.env.V4_PORT ?? "58080";
const baseUrl = (process.env.V4_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
const dataDir = process.env.V4_DATA_DIR ?? join(process.env.TMPDIR ?? "/tmp", "zitadel-v4demo");
const patFile = process.env.V4_PAT_FILE ?? join(dataDir, "admin.pat");
const summaryFile = join(dataDir, "seed-summary.json");

// Fixed in start-v4.sh; it decrypts system.encryption_keys, whose
// idpConfigKey encrypts the IdP client secrets. Reported in the summary.
const MASTER_KEY = "MasterkeyNeedsToHave32Characters";

// Imported password hashes: test vectors from github.com/zitadel/passwap
// (internal/testvalues and the package tests), so the plaintexts are known.
const HASHES = {
  argon2id: {
    format: "argon2id (m=4096, t=3, p=1)",
    encoded: "$argon2id$v=19$m=4096,t=3,p=1$cmFuZG9tc2FsdGlzaGFyZA$DYojYpnUWSMmTtrkVXyaNWVGxLmGe1n8VJBPDdFkbjU",
    plaintext: "password",
  },
  pbkdf2: {
    format: "pbkdf2-sha256 (12 rounds)",
    encoded: "$pbkdf2-sha256$12$cmFuZG9tc2FsdGlzaGFyZA$OFvEcLOIPFd/oq8egf10i.qJLI7A8nDjPLnolCWarQY",
    plaintext: "password",
  },
  md5plain: {
    format: "md5plain (unsalted hex digest)",
    encoded: "5f4dcc3b5aa765d61d8327deb882cf99",
    plaintext: "password",
  },
  sha512crypt: {
    format: "sha512-crypt $6$ (5000 rounds)",
    encoded:
      "$6$rounds=5000$saltstring$svn8UoSVapNtMuq1ukKS4tPQd8iKwSMHWjl/O817G3uBnIFNjnQJuesI68u4OTLiBFdcbYEdFCoEOfaS35inz1",
    plaintext: "Hello world!",
  },
  scrypt: {
    format: "scrypt (ln=16, r=8, p=1)",
    encoded: "$scrypt$ln=16,r=8,p=1$cmFuZG9tc2FsdGlzaGFyZA$Rh+NnJNo1I6nRwaNqbDm6kmADswD1+7FTKZ7Ln9D8nQ",
    plaintext: "password",
  },
  md5crypt: {
    format: "md5-crypt $1$",
    encoded: "$1$kJ4QkJaQ$3EbD/pJddrq5HW3mpZ4KZ1",
    plaintext: "password",
  },
  phpass: {
    format: "phpass $P$ (2^11 rounds)",
    encoded: "$P$9IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0",
    plaintext: "test12345",
  },
  md5salted: {
    format: "md5salted-suffix (md5(password + salt), salt used as stored)",
    encoded: "$md5salted-suffix$c2FsdA==$R58+SD/95ORa9VZ9BPS5FA==",
    plaintext: "Test1000!",
  },
  bcrypt2y: {
    format: "bcrypt $2y$ (cost 12), imported",
    encoded: "$2y$12$hXUrnqdq1RIIYZ2HPytIIe5lXdIvbhqrTvdPsSF7o.jFh817Z6lwm",
    plaintext: "password",
  },
};

// The orgs, in creation order. Initech is deactivated and Umbrella removed at
// the end, after their users exist.
const ORGS = [
  { name: "Acme", expectedState: "active" },
  { name: "Globex", expectedState: "active", userLoginMustBeDomain: true },
  { name: "Initech", expectedState: "inactive (deactivated after its users were added)" },
  { name: "Umbrella", expectedState: "removed (after its user was added)" },
];

// key: unique handle for this script. finally: what happens after creation.
// links: [idp name, external user id, external user name].
const HUMANS = [
  {
    key: "alice@Acme", org: "Acme", username: "alice", given: "Alice", family: "Anderson",
    display: "Alice Anderson", nick: "Ali", lang: "en", gender: "GENDER_FEMALE",
    email: "alice@acme.example.com", emailVerified: true, phone: "+41791234567",
    password: "Alice-Passw0rd!",
    metadata: { department: "Engineering", employee_id: "E-1001" },
    links: [["Corporate SSO", "sso-sub-alice", "alice@sso.example.com"]],
    notes: "verified phone, metadata, authorization on project Shop",
  },
  {
    key: "bob@Acme", org: "Acme", username: "bob", given: "Bob", family: "Brown",
    display: "Bob Brown", lang: "de", gender: "GENDER_MALE",
    email: "bob@acme.example.com", emailVerified: false,
    password: "Bob-Passw0rd!",
    links: [["Corporate SSO", "sso-sub-bob", "bob@sso.example.com"]],
    notes: "unverified email",
  },
  {
    key: "erin@Acme", org: "Acme", username: "erin", given: "Erin", family: "Evans",
    display: "Erin Evans", lang: "en", email: "erin@acme.example.com", emailVerified: true,
    hash: "argon2id",
  },
  {
    key: "frank@Acme", org: "Acme", username: "frank", given: "Frank", family: "Fischer",
    display: "Frank Fischer", lang: "de", email: "frank@acme.example.com", emailVerified: true,
    hash: "pbkdf2",
  },
  {
    key: "samantha@Acme", org: "Acme", username: "samantha", given: "Samantha", family: "Smith",
    display: "Samantha Smith", lang: "en", email: "shared@example.com", emailVerified: true,
    password: "Samantha-Passw0rd!",
    notes: "same email as sam@Default, different case",
  },
  {
    key: "lars@Acme", org: "Acme", username: "lars", given: "Lars", family: "Larsen",
    display: "Lars Larsen", lang: "en", email: "lars@acme.example.com", emailVerified: true,
    password: "Lars-Passw0rd!", finally: "lock",
  },
  {
    key: "oscar@Acme", org: "Acme", username: "oscar", given: "Oscar", family: "Olsen",
    display: "Oscar Olsen", lang: "en", email: "oscar@acme.example.com", emailVerified: true,
    createLinks: [["Acme Okta", "okta-sub-1", "oscar@acme.okta.example.com"]],
    notes: "no password; created with its IdP link (federated-only user)",
  },
  {
    key: "carol@Globex", org: "Globex", username: "carol", given: "Carol", family: "Clark",
    display: "Carol Clark", lang: "fr", gender: "GENDER_DIVERSE",
    email: "carol@globex.example.com", emailVerified: true,
    password: "Carol-Passw0rd!", otpEmail: true,
    links: [["Google", "google-sub-carol", "carol@gmail.example.com"]],
    notes: "OTP via email enabled",
  },
  {
    key: "alice@Globex", org: "Globex", username: "alice", given: "Alice", family: "Garcia",
    display: "Alice Garcia", lang: "es", email: "alice@globex.example.com", emailVerified: true,
    password: "AliceG-Passw0rd!",
    notes: "same username as alice@Acme; unique only within Globex (userLoginMustBeDomain)",
  },
  {
    key: "grace@Globex", org: "Globex", username: "grace", given: "Grace", family: "Green",
    display: "Grace Green", lang: "en", email: "grace@globex.example.com", emailVerified: true,
    hash: "md5plain",
  },
  {
    key: "niaj@Globex", org: "Globex", username: "niaj", given: "Niaj", family: "Nakamura",
    display: "Niaj Nakamura", lang: "ja", email: "niaj@globex.example.com", emailVerified: true,
    hash: "md5crypt",
  },
  {
    key: "dana@Globex", org: "Globex", username: "dana", given: "Dana", family: "Diaz",
    display: "Dana Diaz", lang: "en", email: "dana@globex.example.com", emailVerified: true,
    password: "Dana-Passw0rd!", finally: "deactivate",
  },
  {
    key: "dave@Default", org: "Default", username: "dave", given: "Dave", family: "Davis",
    display: "Dave Davis", lang: "it", email: "dave@example.com", emailVerified: true,
    password: "Dave-Passw0rd!",
    links: [["GitHub", "12345", "dave-gh"]],
    notes: "linked to GitHub, an IdP type outside the migration scope",
  },
  {
    key: "heidi@Default", org: "Default", username: "heidi", given: "Heidi", family: "Hoffmann",
    display: "Heidi Hoffmann", lang: "de", email: "heidi@example.com", emailVerified: true,
    hash: "sha512crypt",
  },
  {
    key: "mallory@Default", org: "Default", username: "mallory", given: "Mallory", family: "Moore",
    display: "Mallory Moore", lang: "en", email: "mallory@example.com", emailVerified: true,
    hash: "phpass",
  },
  {
    key: "olivia@Default", org: "Default", username: "olivia", given: "Olivia", family: "Ortiz",
    display: "Olivia Ortiz", lang: "en", email: "olivia@example.com", emailVerified: true,
    hash: "md5salted",
  },
  {
    key: "peggy@Default", org: "Default", username: "peggy", given: "Peggy", family: "Parker",
    display: "Peggy Parker", lang: "en", email: "peggy@example.com", emailVerified: true,
    hash: "bcrypt2y",
  },
  {
    key: "sam@Default", org: "Default", username: "sam", given: "Sam", family: "Shaw",
    display: "Sam Shaw", lang: "en", email: "Shared@Example.com", emailVerified: true,
    password: "Sam-Passw0rd!", changeRequired: true,
    notes: "same email as samantha@Acme, different case; password change required",
  },
  {
    key: "ian@Default", org: "Default", username: "ian", given: "Ian", family: "Ingram",
    display: "Ian Ingram", lang: "en", email: "ian@example.com", emailVerified: false,
    v1NoPassword: true,
    notes: "created with the v1 API without password: v4 keeps it in the initial state",
  },
  {
    key: "rita@Default", org: "Default", username: "rita", given: "Rita", family: "Russo",
    display: "Rita Russo", lang: "it", email: "rita@example.com", emailVerified: true,
    password: "Rita-Passw0rd!", finally: "delete",
  },
  {
    key: "ivan@Initech", org: "Initech", username: "ivan", given: "Ivan", family: "Ivanov",
    display: "Ivan Ivanov", lang: "en", email: "ivan@initech.example.com", emailVerified: true,
    hash: "scrypt",
  },
  {
    key: "judy@Initech", org: "Initech", username: "judy", given: "Judy", family: "Jones",
    display: "Judy Jones", lang: "en", email: "judy@initech.example.com", emailVerified: true,
    password: "Judy-Passw0rd!",
  },
  {
    key: "albert@Umbrella", org: "Umbrella", username: "albert", given: "Albert", family: "Wesker",
    display: "Albert Wesker", lang: "en", email: "albert@umbrella.example.com", emailVerified: true,
    password: "Albert-Passw0rd!",
  },
];

const EXPECTED_STATE = {
  lock: "locked",
  deactivate: "inactive",
  delete: "removed",
};

class ApiError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} -> HTTP ${status}: ${body}`);
    this.status = status;
  }
}

const pat = (await readFile(patFile, "utf8").catch((err) => {
  console.error(`cannot read the admin PAT at ${patFile}: ${err.message}`);
  console.error("start v4 with start-v4.sh first (same V4_DATA_DIR), or set V4_PAT_FILE");
  process.exit(1);
})).trim();

async function api(method, path, body, { orgId, connect = false } = {}) {
  const headers = { authorization: `Bearer ${pat}`, accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (connect) headers["connect-protocol-version"] = "1";
  if (orgId) headers["x-zitadel-orgid"] = orgId;
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError(method, path, res.status, text);
  return text ? JSON.parse(text) : {};
}

// v2 services without REST routes in v4 are served over the Connect protocol.
const rpc = (service, method, body) => api("POST", `/${service}/${method}`, body, { connect: true });

// Retries a read until the projection behind it caught up.
async function eventually(read, attempts = 40) {
  for (let i = 1; ; i++) {
    try {
      return await read();
    } catch (err) {
      if (i >= attempts || !(err instanceof ApiError) || err.status !== 404) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

const log = (msg) => console.error(`[seed] ${msg}`);
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

async function main() {
  // Refuse a second run before writing anything.
  const acme = await api("POST", "/v2/organizations/_search", {
    queries: [{ name_query: { name: "Acme", method: "TEXT_QUERY_METHOD_EQUALS" } }],
  });
  if ((acme.result ?? []).length > 0) {
    console.error(
      `already seeded: org "Acme" exists (${acme.result[0].id}). seed-v4.mjs is not idempotent; ` +
        "reset the database to seed again (README.md).",
    );
    process.exit(2);
  }

  const { instance } = await api("GET", "/admin/v1/instances/me");
  const defaultOrg = (await api("GET", "/admin/v1/orgs/default")).org;
  log(`instance ${instance.id} (${instance.name}), default org ${defaultOrg.id} (${defaultOrg.name})`);

  // Orgs.
  const orgs = { Default: { name: defaultOrg.name, id: defaultOrg.id, expectedState: "active" } };
  for (const spec of ORGS) {
    const { organizationId } = await api("POST", "/v2/organizations", { name: spec.name });
    orgs[spec.name] = { name: spec.name, id: organizationId, expectedState: spec.expectedState };
    log(`org ${spec.name}: ${organizationId}`);
    if (spec.userLoginMustBeDomain) {
      // Org-level custom domain policy (admin API); usernames become unique per org.
      await api("POST", `/admin/v1/orgs/${organizationId}/policies/domain`, {
        user_login_must_be_domain: true,
        validate_org_domains: false,
        smtp_sender_address_matches_instance_domain: false,
      });
      orgs[spec.name].domainPolicy = { userLoginMustBeDomain: true, scope: "org" };
      log(`org ${spec.name}: custom domain policy userLoginMustBeDomain=true`);
    }
  }

  // IdPs. Instance-level ones through the admin API, org-level ones through the
  // management API in the org's context.
  const idps = {};
  const scopes = ["openid", "profile", "email"];
  async function addIdp(name, type, path, body, owner) {
    const orgId = owner === "instance" ? undefined : orgs[owner].id;
    const res = await api("POST", path, { name, ...body }, { orgId });
    const o = body.provider_options;
    idps[name] = {
      name,
      id: res.id,
      type,
      owner: owner === "instance" ? "instance" : "org",
      ownerOrg: owner === "instance" ? null : owner,
      ownerOrgId: orgId ?? null,
      issuer: body.issuer ?? null,
      clientId: body.client_id,
      clientSecret: body.client_secret,
      scopes: body.scopes,
      usePkce: body.use_pkce ?? null,
      isIdTokenMapping: body.is_id_token_mapping ?? null,
      options: {
        isCreationAllowed: Boolean(o.is_creation_allowed),
        isLinkingAllowed: Boolean(o.is_linking_allowed),
        isAutoCreation: Boolean(o.is_auto_creation),
        isAutoUpdate: Boolean(o.is_auto_update),
        autoLinking: o.auto_linking ?? "AUTO_LINKING_OPTION_UNSPECIFIED",
      },
      loginPolicies: [],
    };
    log(`idp ${name}: ${res.id}`);
  }
  await addIdp(
    "Corporate SSO",
    "generic_oidc",
    "/admin/v1/idps/generic_oidc",
    {
      issuer: "https://sso.example.com",
      client_id: "corp-client",
      client_secret: "corp-secret-123",
      scopes,
      use_pkce: true,
      is_id_token_mapping: false,
      provider_options: {
        is_creation_allowed: true,
        is_linking_allowed: true,
        is_auto_creation: true,
        is_auto_update: true,
      },
    },
    "instance",
  );
  await addIdp(
    "Acme Okta",
    "generic_oidc",
    "/management/v1/idps/generic_oidc",
    {
      issuer: "https://acme.okta.example.com",
      client_id: "acme-client",
      client_secret: "acme-secret-456",
      scopes,
      use_pkce: false,
      is_id_token_mapping: true,
      provider_options: {
        is_creation_allowed: true,
        is_linking_allowed: true,
        is_auto_creation: false,
        is_auto_update: false,
        auto_linking: "AUTO_LINKING_OPTION_EMAIL",
      },
    },
    "Acme",
  );
  await addIdp(
    "Google",
    "google",
    "/admin/v1/idps/google",
    {
      client_id: "google-client",
      client_secret: "google-secret-789",
      scopes,
      provider_options: { is_creation_allowed: true, is_linking_allowed: true, is_auto_update: true },
    },
    "instance",
  );
  await addIdp(
    "GitHub",
    "github",
    "/admin/v1/idps/github",
    {
      client_id: "github-client",
      client_secret: "github-secret-000",
      scopes: ["read:user", "user:email"],
      provider_options: { is_creation_allowed: false, is_linking_allowed: true },
    },
    "instance",
  );

  // Login policies: Corporate SSO on the instance policy; Acme gets its own
  // org login policy (a copy of the default) offering Corporate SSO and Acme Okta.
  await api("POST", "/admin/v1/policies/login/idps", { idp_id: idps["Corporate SSO"].id });
  idps["Corporate SSO"].loginPolicies = ["instance", "Acme"];
  const def = (await api("GET", "/management/v1/policies/default/login", undefined, { orgId: orgs.Acme.id }))
    .policy;
  await api(
    "POST",
    "/management/v1/policies/login",
    {
      allow_username_password: def.allowUsernamePassword ?? false,
      allow_register: def.allowRegister ?? false,
      allow_external_idp: true,
      force_mfa: def.forceMfa ?? false,
      passwordless_type: def.passwordlessType,
      hide_password_reset: def.hidePasswordReset ?? false,
      ignore_unknown_usernames: def.ignoreUnknownUsernames ?? false,
      default_redirect_uri: def.defaultRedirectUri ?? "",
      password_check_lifetime: def.passwordCheckLifetime,
      external_login_check_lifetime: def.externalLoginCheckLifetime,
      mfa_init_skip_lifetime: def.mfaInitSkipLifetime,
      second_factor_check_lifetime: def.secondFactorCheckLifetime,
      multi_factor_check_lifetime: def.multiFactorCheckLifetime,
      second_factors: def.secondFactors ?? [],
      multi_factors: def.multiFactors ?? [],
      allow_domain_discovery: def.allowDomainDiscovery ?? false,
      disable_login_with_email: def.disableLoginWithEmail ?? false,
      disable_login_with_phone: def.disableLoginWithPhone ?? false,
      force_mfa_local_only: def.forceMfaLocalOnly ?? false,
      idps: [
        { idp_id: idps["Corporate SSO"].id, ownerType: "IDP_OWNER_TYPE_SYSTEM" },
        { idp_id: idps["Acme Okta"].id, ownerType: "IDP_OWNER_TYPE_ORG" },
      ],
    },
    { orgId: orgs.Acme.id },
  );
  idps["Acme Okta"].loginPolicies = ["Acme"];
  orgs.Acme.loginPolicy = "custom org login policy: Corporate SSO + Acme Okta";
  log("login policies: instance += Corporate SSO; Acme custom policy with Corporate SSO + Acme Okta");

  // Human users.
  const users = [];
  for (const spec of HUMANS) {
    const orgId = orgs[spec.org].id;
    let id;
    if (spec.v1NoPassword) {
      // v1 AddHumanUser without password adds an init code: state "initial".
      // The v2 API never does that; its password-less users are active.
      const res = await api(
        "POST",
        "/management/v1/users/human",
        {
          user_name: spec.username,
          profile: {
            first_name: spec.given,
            last_name: spec.family,
            display_name: spec.display,
            preferred_language: spec.lang,
          },
          email: { email: spec.email, is_email_verified: spec.emailVerified },
        },
        { orgId },
      );
      id = res.userId;
    } else {
      const human = {
        profile: {
          given_name: spec.given,
          family_name: spec.family,
          display_name: spec.display,
          preferred_language: spec.lang,
          ...(spec.nick ? { nick_name: spec.nick } : {}),
          ...(spec.gender ? { gender: spec.gender } : {}),
        },
        // return_code leaves the email unverified without sending a mail.
        email: spec.emailVerified
          ? { email: spec.email, is_verified: true }
          : { email: spec.email, return_code: {} },
      };
      if (spec.phone) human.phone = { phone: spec.phone, is_verified: true };
      if (spec.password) {
        human.password = { password: spec.password, change_required: Boolean(spec.changeRequired) };
      }
      if (spec.hash) {
        human.hashed_password = { hash: HASHES[spec.hash].encoded, change_required: false };
      }
      if (spec.createLinks) {
        human.idp_links = spec.createLinks.map(([idp, userId, userName]) => ({
          idp_id: idps[idp].id,
          user_id: userId,
          user_name: userName,
        }));
      }
      const res = await api("POST", "/v2/users/new", { organization_id: orgId, username: spec.username, human });
      id = res.id;
    }
    const user = {
      key: spec.key,
      id,
      username: spec.username,
      org: spec.org,
      orgId,
      expectedState: EXPECTED_STATE[spec.finally] ?? (spec.v1NoPassword ? "initial" : "active"),
      password: spec.password
        ? {
            kind: "plaintext",
            plaintext: spec.password,
            storedAs: "bcrypt (hashed by v4)",
            changeRequired: Boolean(spec.changeRequired),
          }
        : spec.hash
          ? {
              kind: "imported-hash",
              format: HASHES[spec.hash].format,
              encoded: HASHES[spec.hash].encoded,
              plaintext: HASHES[spec.hash].plaintext,
            }
          : { kind: "none" },
      email: spec.email,
      emailVerified: spec.emailVerified,
      phone: spec.phone ?? null,
      phoneVerified: spec.phone ? true : null,
      preferredLanguage: spec.lang,
      links: [],
      notes: spec.notes ?? null,
    };
    for (const [idp, userId, userName] of spec.createLinks ?? []) {
      user.links.push({ idp, idpId: idps[idp].id, externalUserId: userId, externalUserName: userName });
    }
    users.push(user);
    log(`user ${spec.key}: ${id}`);
  }
  const byKey = Object.fromEntries(users.map((u) => [u.key, u]));

  // Profile extras: metadata, OTP email, IdP links.
  for (const spec of HUMANS) {
    const user = byKey[spec.key];
    if (spec.metadata) {
      await api("POST", `/v2/users/${user.id}/metadata`, {
        metadata: Object.entries(spec.metadata).map(([key, value]) => ({ key, value: b64(value) })),
      });
      user.metadata = spec.metadata;
      log(`user ${spec.key}: metadata ${Object.keys(spec.metadata).join(", ")}`);
    }
    if (spec.otpEmail) {
      await api("POST", `/v2/users/${user.id}/otp_email`, {});
      user.mfa = ["otp_email"];
      log(`user ${spec.key}: OTP email added`);
    }
    for (const [idp, userId, userName] of spec.links ?? []) {
      await api("POST", `/v2/users/${user.id}/links`, {
        idp_link: { idp_id: idps[idp].id, user_id: userId, user_name: userName },
      });
      user.links.push({ idp, idpId: idps[idp].id, externalUserId: userId, externalUserName: userName });
      log(`user ${spec.key}: linked to ${idp} as ${userId}`);
    }
  }

  // Inventory: a machine user with a PAT, a project with a role and an OIDC
  // app, an authorization for alice@Acme, and an actions v2 target.
  const ciBot = await api("POST", "/v2/users/new", {
    organization_id: orgs.Acme.id,
    username: "ci-bot",
    machine: { name: "CI Bot", description: "Deploys the shop", access_token_type: "ACCESS_TOKEN_TYPE_BEARER" },
  });
  const ciBotPat = await api("POST", `/v2/users/${ciBot.id}/pats`, { expiration_date: "2030-01-01T00:00:00Z" });
  log(`machine user ci-bot@Acme: ${ciBot.id}, PAT ${ciBotPat.tokenId}`);

  const project = await rpc("zitadel.project.v2.ProjectService", "CreateProject", {
    organization_id: orgs.Acme.id,
    name: "Shop",
    project_role_assertion: true,
    authorization_required: false,
    project_access_required: false,
  });
  await rpc("zitadel.project.v2.ProjectService", "AddProjectRole", {
    project_id: project.projectId,
    role_key: "customer",
    display_name: "Customer",
    group: "shop",
  });
  const app = await rpc("zitadel.application.v2.ApplicationService", "CreateApplication", {
    project_id: project.projectId,
    name: "Shop Web",
    oidc_configuration: {
      redirect_uris: ["http://localhost:3000/api/auth/callback"],
      post_logout_redirect_uris: ["http://localhost:3000/"],
      response_types: ["OIDC_RESPONSE_TYPE_CODE"],
      grant_types: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
      application_type: "OIDC_APP_TYPE_WEB",
      auth_method_type: "OIDC_AUTH_METHOD_TYPE_BASIC",
      development_mode: true,
    },
  });
  const authorization = await rpc("zitadel.authorization.v2.AuthorizationService", "CreateAuthorization", {
    user_id: byKey["alice@Acme"].id,
    project_id: project.projectId,
    organization_id: orgs.Acme.id,
    role_keys: ["customer"],
  });
  log(`project Shop: ${project.projectId}, app ${app.applicationId}, authorization ${authorization.id}`);
  // v4 resolves the endpoint and refuses hosts that do not resolve or resolve
  // to private addresses, so the target needs DNS; skip it when offline.
  let target = null;
  try {
    const res = await api("POST", "/v2/actions/targets", {
      name: "audit-webhook",
      endpoint: "https://example.com/hooks/zitadel",
      timeout: "10s",
      rest_webhook: { interrupt_on_error: false },
    });
    target = { name: "audit-webhook", id: res.id, endpoint: "https://example.com/hooks/zitadel" };
    log(`action target audit-webhook: ${res.id}`);
  } catch (err) {
    if (!(err instanceof ApiError) || !err.message.includes("Errors.Target.DeniedURL")) throw err;
    log(`action target skipped: v4 refused the endpoint (no DNS?): ${err.message}`);
  }

  // Login names as v4 computes them, read before any user or org goes away.
  async function readUser(id) {
    const { user } = await eventually(() => api("GET", `/v2/users/${id}`));
    return user;
  }
  for (const user of users) {
    const read = await readUser(user.id);
    user.loginName = read.preferredLoginName;
    user.loginNames = read.loginNames;
  }
  const admins = await api("POST", "/v2/users", {
    queries: [
      { organization_id_query: { organization_id: orgs.Default.id } },
      { user_name_query: { user_name: "zitadel-admin", method: "TEXT_QUERY_METHOD_STARTS_WITH" } },
    ],
  });
  const admin = admins.result?.[0];
  const serviceAccounts = await api("POST", "/v2/users", {
    queries: [
      { organization_id_query: { organization_id: orgs.Default.id } },
      { user_name_query: { user_name: "admin-sa", method: "TEXT_QUERY_METHOD_EQUALS" } },
    ],
  });
  const adminSa = serviceAccounts.result?.[0];
  const orgList = await api("POST", "/v2/organizations/_search", {});
  for (const org of orgList.result ?? []) {
    const entry = Object.values(orgs).find((o) => o.id === org.id);
    if (entry) entry.primaryDomain = org.primaryDomain;
  }

  // State changes, last: lock, deactivate, delete, then the orgs.
  for (const spec of HUMANS.filter((s) => s.finally)) {
    const user = byKey[spec.key];
    if (spec.finally === "lock") await api("POST", `/v2/users/${user.id}/lock`, {});
    if (spec.finally === "deactivate") await api("POST", `/v2/users/${user.id}/deactivate`, {});
    if (spec.finally === "delete") await api("DELETE", `/v2/users/${user.id}`);
    log(`user ${spec.key}: ${spec.finally}`);
  }
  await api("POST", `/v2/organizations/${orgs.Initech.id}/deactivate`, {});
  log("org Initech: deactivated");
  await api("DELETE", `/v2/organizations/${orgs.Umbrella.id}`);
  log("org Umbrella: removed");
  for (const user of users.filter((u) => u.org === "Umbrella")) {
    user.expectedState = "removed with its org";
  }

  // Read the states back as v4 reports them, giving the projection time to
  // catch up with the state changes.
  const API_STATE = {
    active: "USER_STATE_ACTIVE",
    initial: "USER_STATE_INITIAL",
    locked: "USER_STATE_LOCKED",
    inactive: "USER_STATE_INACTIVE",
  };
  for (const user of users) {
    const want = API_STATE[user.expectedState] ?? "not found";
    for (let attempt = 1; attempt <= 20; attempt++) {
      try {
        user.observedState = (await api("GET", `/v2/users/${user.id}`)).user.state;
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) throw err;
        user.observedState = "not found";
      }
      if (user.observedState === want) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (user.observedState !== want) {
      log(`WARNING ${user.key}: v4 reports ${user.observedState}, expected ${want}`);
    }
  }

  const summary = {
    v4: {
      url: baseUrl,
      version: instance.version,
      instanceId: instance.id,
      instanceName: instance.name,
      masterKey: MASTER_KEY,
      adminPatFile: patFile,
    },
    orgs: Object.values(orgs),
    idps: Object.values(idps),
    users: [
      ...(admin
        ? [
            {
              key: "zitadel-admin@Default",
              id: admin.userId,
              username: admin.username,
              org: "Default",
              orgId: orgs.Default.id,
              expectedState: "active",
              observedState: admin.state,
              loginName: admin.preferredLoginName,
              password: {
                kind: "plaintext",
                plaintext: "Password1!",
                storedAs: "bcrypt (hashed by v4)",
                changeRequired: true,
              },
              email: admin.human?.email?.email ?? null,
              emailVerified: admin.human?.email?.isVerified ?? null,
              links: [],
              notes: "first-instance human admin (IAM_OWNER), created by start-v4.sh",
            },
          ]
        : []),
      ...users,
    ],
    machineUsers: [
      {
        username: "admin-sa",
        org: "Default",
        id: adminSa?.userId ?? null,
        notes: "first-instance IAM_OWNER created by start-v4.sh; its PAT is in adminPatFile",
      },
      {
        username: "ci-bot",
        org: "Acme",
        id: ciBot.id,
        patTokenId: ciBotPat.tokenId,
        patExpiration: "2030-01-01T00:00:00Z",
      },
    ],
    links: users.flatMap((u) => u.links.map((l) => ({ user: u.key, userId: u.id, ...l }))),
    inventory: {
      project: { name: "Shop", id: project.projectId, org: "Acme", roles: ["customer"] },
      app: { name: "Shop Web", id: app.applicationId, clientId: app.oidcConfiguration?.clientId ?? null },
      authorization: { id: authorization.id, user: "alice@Acme", project: "Shop", roles: ["customer"] },
      actionTarget: target,
    },
  };
  const json = JSON.stringify(summary, null, 2);
  await mkdir(dataDir, { recursive: true });
  await writeFile(summaryFile, `${json}\n`);
  log(`summary written to ${summaryFile}`);
  console.log(json);
}

main().catch((err) => {
  console.error(`[seed] FAILED: ${err.message}`);
  console.error("[seed] the instance is now partly seeded; reset the database before running again (README.md)");
  process.exit(1);
});
