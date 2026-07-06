# Flutter Client SDK Plan

> **Status:** Draft
> **Date:** 2026-07-06
> **See also:** [BDUI Renderer](../cli/bdui-renderer.md) · [Flow Engine](../flowengine/flow-engine.md) · [Flow Engine — Step Response Shape](../flowengine/flow-engine-nodes.md)

## Context

The monorepo ships nine `@zitadel/sdk-*` npm packages, all thin TypeScript wrappers around the Lit web components in [`packages/components`](../../../packages/components) (`<zitadel-login>` etc.) that drive the server-driven-UI ("BDUI") flow API. There is no Dart/Flutter code anywhere in the repo today. A Flutter client cannot host web components, so it becomes the repo's **first native renderer** of the flow contract — the category [bdui-renderer.md](../cli/bdui-renderer.md) anticipates as "headless"/native.

Goal: a pub.dev-published Flutter SDK with the same product role as the web SDKs — embedded login/logout/session UI plus a headless client — following repo conventions (Moon tasks, MIT license, package layout) where they apply.

## Scope decisions

1. **Headless Dart flow/session client plus prebuilt Flutter widgets** (parity with the web components' role). Consumers who want their own UI use the headless layer directly.
2. **Handwritten thin Dart client** for the ~8 endpoints used, hardened with **spec-lock tests** (chosen over an OpenAPI generator). Rationale: the spec is OpenAPI 3.1 with `oneOf`/null usage where Dart generators (openapi-generator dart-dio, swagger_dart_code_generator) have experimental support; a generator would add a Java toolchain to CI and force dio/built_value/build_runner onto SDK consumers; and the load-bearing runtime (cookie replay, 400-unwrap, bearer) is handwritten in both approaches. The generator's one real advantage — mechanical drift detection against the in-repo spec — is recovered by the spec-lock test in [Testing](#testing).
3. A Flutter **demo app** in `apps/`, analogous to [`apps/demo-next`](../../../apps/demo-next).

## Verified contract facts (source of truth)

- Models come from [`api/openapi/components/flows/*.yaml`](../../../api/openapi/components/flows/) — **not** from [flow-engine-nodes.md](../flowengine/flow-engine-nodes.md), which is stale on this point: the spec defines `fields`/`actions` as **ordered arrays** (server controls order; no Liquid template needed natively) and only `gates` as a map.
  - `FlowResponse`: `{ id, session_id, session_token?, step, branding?, redirect_uri?, handoff_token?, handoff_token_expires_at? }`. `id` may rotate on pivot/pop — re-read from every response.
  - `FlowStep`: `{ name, texts?{title_key,description_key}, error?, complete? ∈ {redirect,show}, fields: FlowField[], actions: FlowAction[], gates: Map<String,FlowGate>, sso_providers[], challenge? }`.
  - `FlowField`: `{ name, type ∈ {text,email,password,tel,number,url,date,hidden,checkbox,select}, text_key, required, value?, validation?{format,min_length,max_length,enum[]} }`.
  - `FlowAction`: `{ name, kind ∈ {submit,passkey,passkey_register,navigate,back}, primary, text_key? }`.
  - Submit body: `{ action, fields{}, gate_proofs{}, challenge_response?, sso_provider_id?, session_token? }`.
- Endpoints (mirroring [`packages/components/src/orchestrator/api-client.ts`](../../../packages/components/src/orchestrator/api-client.ts)): `POST /flow` (public, `security: []`), `POST /flow/{id}/submit`, `GET /flow/{id}`, `POST /sessions/exchange?project_id=`, `GET /sessions/me`, `DELETE /sessions/me`.
- Flow state lives in the encrypted `_zflow` cookie (server stateless) — a native client must capture/replay `Set-Cookie` itself.
- `POST /sessions/exchange` **requires a project service key**; browsers get it via the framework proxy which injects `Bearer ${ZITADEL_PROJECT_SECRET}` ([`packages/sdk-next/src/middleware.ts`](../../../packages/sdk-next/src/middleware.ts) ~line 236). The exchange response returns `session_token` **in the body**, so mobile stores it securely and uses `Authorization: Bearer` on `/sessions/me` — bearer-for-mobile is explicitly anticipated in the same middleware (~line 330).
- Behavior to port from [`zitadel-login.ts`](../../../packages/components/src/orchestrator/zitadel-login.ts) / [`api-client.ts`](../../../packages/components/src/orchestrator/api-client.ts): 400-with-`step`-in-body unwrapped as a normal step (field validation errors); seed values from `field.value`; carry values across steps but submit only the current step's declared fields; `step.error` starting `error.` is a text_key else raw; `complete:"redirect"` → follow `redirect_uri`, `complete:"show"` → exchange handoff; double-submit guard.
- Localization: server sends only `text_key`s; built-in locales en/de/it in [`packages/components/src/orchestrator/locales/`](../../../packages/components/src/orchestrator/locales/); missing key falls back to the raw key.
- Moon runs unknown toolchains as system commands; projects register in `.moon/workspace.yml` `projects.sources`. Dart packages have no `package.json` → automatically invisible to pnpm workspaces and the Changesets fixed npm release group; no changes needed there.

## Packages & layout

| Path | pub.dev name | Contents |
|---|---|---|
| `packages/sdk-dart` | `zitadel_client` | Pure Dart: models, transport, cookie/token stores, `FlowClient`/`SessionClient`, errors, locales. Usable from Dart CLIs/servers. |
| `packages/sdk-flutter` | `zitadel_flutter` | `FlowController`, `ZitadelLogin`/`ZitadelSession`/`ZitadelLogout` widgets, branding theme, secure storage (`flutter_secure_storage`), altcha solver, pub-required `example/`. |
| `apps/demo-flutter` | unpublished | Reference app, analogous to `apps/demo-next`. |

Each package: `pubspec.yaml`, `analysis_options.yaml` (`package:lints/recommended`), `moon.yml`, `LICENSE` (MIT, copy from `packages/sdk-react/LICENSE`), `README.md`, `CHANGELOG.md`, `lib/src/…`, `test/`. The name `zitadel` on pub.dev is taken by the legacy package — use `zitadel_client`/`zitadel_flutter` (pub lower_snake_case rules).

Local linkage: `zitadel_flutter` declares `zitadel_client: ^0.1.0-alpha.1` plus a committed `pubspec_overrides.yaml` with `path: ../sdk-dart` (ignored at publish time; standard monorepo mechanism — melos is unnecessary for two packages).

### `packages/sdk-dart` internals

```
lib/zitadel_client.dart          # barrel
lib/src/config.dart              # ZitadelProject + configureZitadel(...) — mirrors packages/api/src/runtime/config.ts;
                                 #   baseUrl REQUIRED and absolute (no page origin on mobile)
lib/src/errors.dart              # ZitadelApiException{status,url,code,message,details,rawBody}
                                 #   — mirrors ApiError (runtime/fetch.ts) + api/openapi/components/error-details.yaml
lib/src/http/transport.dart      # ZitadelTransport interface; ZitadelResponse{status,jsonBody,setCookies:List<String>}
lib/src/http/io_transport.dart   # dart:io HttpClient impl — package:http folds multiple Set-Cookie lossily, dart:io doesn't
lib/src/http/cookie_store.dart   # CookieStore + InMemoryCookieStore: parse Set-Cookie, honor Max-Age=0, replay _zflow
lib/src/storage/token_store.dart # TokenStore + InMemoryTokenStore for session_token
lib/src/models/…                 # flow_response, flow_step, field, action, gate, sso_provider, branding,
                                 #   challenge, session, submit_request — immutable, hand-written fromJson/toJson,
                                 #   unknown JSON keys ignored, unknown enum strings → `unknown` variant
lib/src/flow_client.dart         # create()/submit()/current(); submit() replicates the 400-with-step unwrap
lib/src/session_client.dart      # exchange() (writes session_token to tokenStore), me() (Bearer), revoke() (clears store)
lib/src/l10n/localizer.dart      # ZitadelLocalizer.resolve({languageCode, overrides}); t(key) → key on miss
lib/src/l10n/{en,de,it}.dart     # hand-ported from packages/components/src/orchestrator/locales/*.ts (comment the source)
```

### `packages/sdk-flutter` internals

- `lib/src/controller/flow_controller.dart` — `ChangeNotifier` porting the `zitadel-login.ts` state machine: sealed `FlowUiState` (`FlowLoading | FlowStepReady{response,values,submitting,error} | FlowCompleted{completion} | FlowFailed`), `start()` (create or resume via `current(resumeFlowId)`), `setValue()`, `submitAction()` (filter values to current step's fields, double-submit guard, re-read flow id), optional `autoExchange`.
- `lib/src/widgets/` — `ZitadelLogin` (props: `project`, `purpose`, `resumeFlowId`, `autoExchange`, `languageCode`, `localeOverrides`, `theme`, builders; callbacks `onStep`/`onInput`/`onComplete`/`onError`/`onUnsupportedCapability` mirroring the web `zitadel-flow-*` events), `ZitadelSession` (builder over `SessionClient.me()`), `ZitadelLogout` (calls `revoke()`, `onSignedOut` ≙ `zitadel-signout`), plus `step_renderer.dart`, field widgets, actions, error banner.
- Step renderer maps ordered arrays → Material widgets (no Liquid): fields → `TextFormField`/`Checkbox`/`DropdownButtonFormField`/date picker with autofill hints and `validation`-derived client-side validators (server authoritative); hidden fields submitted but not rendered; actions → `FilledButton` (primary submit) / `TextButton`; `passkey*` actions hidden in v1; gates → **altcha only** in v1 (pure SHA-256 proof-of-work solved in an isolate via `package:crypto` in `lib/src/gates/altcha_solver.dart`, submitted via `gate_proofs`); turnstile/hcaptcha and SSO surface `onUnsupportedCapability` (SSO behind an `enableSso` flag, default off).
- Completion: `redirect` → hand `redirect_uri` to `onComplete` (no `url_launcher` dependency; document the recipe); `show` + `autoExchange` → exchange handoff, store token, `onComplete` with session.
- `lib/src/theme/branding_theme.dart` — maps `branding` (`logo_url`, `layout`, `hero_url`) onto theme; `liquid_template` explicitly ignored. `lib/src/storage/secure_token_store.dart` + secure cookie store on `flutter_secure_storage` so a killed app can resume via `current(flowId)`.

## Reaching the API

`baseUrl` is required. Documented default: **the app's own credentialed proxy** (e.g. `https://myapp.example/__nextgen` from `sdk-next`/`sdk-nuxt` middleware) because exchange needs the project secret, which must never ship in the app binary (README warning). Direct URLs (`http://localhost:8080`, Android emulator `http://10.0.2.2:8080`, `apps/mock-zitadel`) work for the flow itself; a 401 on exchange gets an error message explaining the proxy requirement. Escape hatch: `configureZitadel(..., transport: BearerTransport(tokenProvider))` for server-side Dart.

## Monorepo integration (files to modify)

- `.moon/workspace.yml` — add `sdk-dart`, `sdk-flutter`, `demo-flutter` to `projects.sources`.
- `.github/workflows/ci.yml` — add `subosito/flutter-action@v2` (pinned version, `cache: true`) to the `full-pr` job before the `moon ci` step; Moon affected-detection keeps Dart tasks off unrelated PRs.
- `.gitignore` — `.dart_tool/`, library `pubspec.lock`s (the demo app's lock IS committed), `apps/demo-flutter/build/`, `packages/sdk-flutter/build/`, `.flutter-plugins-dependencies` (scoped paths).
- `AGENTS.md` — extend the package map; note the Dart packages sit outside pnpm/changesets with their own release path.
- New per-package `moon.yml` (pattern, `sdk-dart` shown; sdk-flutter/demo use `flutter` commands and `deps: ["sdk-dart:typecheck"]`):

```yaml
id: "sdk-dart"
language: "dart"        # moon runs unknown toolchains as system commands
layer: "library"
tasks:
  lint:      { command: "dart format --output=none --set-exit-if-changed ." }
  typecheck: { command: "dart pub get && dart analyze --fatal-infos" }
  test:      { command: "dart pub get && dart test" }
```

## Testing

1. **Unit (sdk-dart)** — model round-trips against fixtures copied from the spec examples (`flow-step.yaml`, `flow-response.yaml`); 400-unwrap and error mapping via `FakeTransport`; cookie parse/expiry/`Max-Age=0`; altcha solver on a known challenge; localizer fallback/overrides.
2. **Spec-lock (sdk-dart, `test/spec_lock_test.dart`)** — the drift guard that replaces codegen: parses the in-repo OpenAPI YAML for the schemas the SDK models (`api/openapi/components/flows/{flow-step,field,step-action,gate,flow-response,flow-submit-request,create-flow-request}.yaml`, session response/exchange schemas, `error-details.yaml`) using `package:yaml`, resolves local `$ref`s, and asserts each Dart model declares matching property names, `required` lists, and enum values (Dart models expose a `specProperties` manifest or use serialization reflection via `toJson` on a fully-populated instance). Any PR that changes those spec files fails this test until the Dart models are updated — mechanical sync without a generator. Runs as part of `moon run sdk-dart:test`; the spec files are declared as task `inputs` in `moon.yml` so spec-only PRs still trigger it under Moon's affected detection.
3. **Contract (sdk-dart, `dart test --tags contract`)** — start `apps/mock-zitadel` (port 8080), drive a real register/login flow incl. `_zflow` round-trip and handoff exchange; skip when the port is unavailable.
4. **Widget (sdk-flutter)** — pump `ZitadelLogin` with a mocked `FlowClient`: server-ordered fields with localized labels, submit sends only declared fields, error banner (key + raw), value carry-over, double-submit guard, `onComplete`.
5. **E2E (deferred, M5)** — `apps/demo-flutter/integration_test/` on the Linux desktop target against mock-zitadel (own CI job; needs GTK deps), satisfying the AGENTS.md per-SDK e2e requirement.

## Demo app (`apps/demo-flutter`)

Home (signed-out → sign-in button; signed-in → `ZitadelSession` + `ZitadelLogout`), Login (`ZitadelLogin` with `autoExchange: true`), Settings (base URL + project id via `shared_preferences`, default `http://10.0.2.2:8080`). README documents three run modes: mock-zitadel, `npx @zitadel/cli start`, and a deployed demo-next proxy URL for the full exchange path.

## Release

Independent versioning from the npm lockstep train, starting `0.1.0-alpha.1`, both Dart packages version-locked to each other; hand-maintained CHANGELOGs; tags `flutter-v<version>`. New `.github/workflows/release-flutter.yml` (`workflow_dispatch` + `dry_run` boolean, mirroring `release-publish.yml`): flutter-action → analyze+test → `dart pub publish --dry-run` always → real publish of `zitadel_client` then `zitadel_flutter` via pub.dev **GitHub Actions OIDC automated publishing** (`id-token: write`, no long-lived secret), with a retry loop waiting for `zitadel_client` to resolve before publishing `zitadel_flutter`.

## Milestones

- **M1 — Dart core**: `packages/sdk-dart` complete with unit + spec-lock + contract tests; moon/CI/gitignore wiring. *DoD:* `moon run sdk-dart:lint sdk-dart:typecheck sdk-dart:test` green in CI; spec-lock test demonstrably fails on a mutated spec fixture; contract test passes against mock-zitadel.
- **M2 — Flutter widgets**: `packages/sdk-flutter` complete with widget tests and `example/`. *DoD:* widget suite green in CI; example signs in against mock-zitadel.
- **M3 — Demo app + docs**: `apps/demo-flutter`, README run modes, AGENTS.md update. *DoD:* full register/login/logout journey via `flutter run` against local Zitadel and the mock server.
- **M4 — Release wiring**: `release-flutter.yml`, pub.dev config, CHANGELOGs. *DoD:* `0.1.0-alpha.1` of both packages on pub.dev.
- **M5 — deferred**: passkeys (platform channels/`credential_manager`), SSO (external browser + app-link resume), turnstile/hcaptcha gates, web platform target, integration_test e2e CI job, CLI scaffolder adapter ([`apps/cli/src/lib/orca/`](../../../apps/cli/src/lib/orca/)), automated locale sync from the TS dictionaries, PKCE fallback client.

## Verification

- `moon run sdk-dart:{lint,typecheck,test}` (+ sdk-flutter/demo equivalents) pass locally and in the `full-pr` CI job; an unrelated-file PR does not trigger Dart tasks.
- Contract test transcript shows `_zflow` echoed on submit and `410` on handoff-token replay.
- Manual: demo app on an Android emulator completes login incl. exchange through a demo-next proxy; `ZitadelSession` shows `state: active`; logout clears the stored token.
- `dart pub publish --dry-run` clean for both packages (validates LICENSE, example/, no path-dep leak).

## Critical reference files

- [`api/openapi/components/flows/`](../../../api/openapi/components/flows/) `{flow-step,field,step-action,gate,flow-response,flow-submit-request,create-flow-request}.yaml` — model source of truth
- [`packages/components/src/orchestrator/zitadel-login.ts`](../../../packages/components/src/orchestrator/zitadel-login.ts) and [`api-client.ts`](../../../packages/components/src/orchestrator/api-client.ts) — state machine + client semantics to port
- [`packages/api/src/runtime/`](../../../packages/api/src/runtime/) `{config,fetch,auth,base-url}.ts` — config-handle and error shapes to mirror
- [`packages/sdk-next/src/middleware.ts`](../../../packages/sdk-next/src/middleware.ts) — proxy/secret-injection and bearer-auth model
- `.moon/workspace.yml`, `.github/workflows/ci.yml` — the only existing files modified for integration
- [`packages/components/src/orchestrator/locales/`](../../../packages/components/src/orchestrator/locales/) — locale dictionaries to port
